import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  assignableRoles,
  canManageMember,
  hasPermissions,
  permissionsForRole,
} from './access.js';

describe('role definitions', () => {
  it('only reference permissions that exist in the catalog', () => {
    for (const role of ROLE_KEYS) {
      for (const permission of permissionsForRole(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('never grant a lower-ranked role a permission a higher-ranked role lacks', () => {
    const byRank = [...ROLE_KEYS].sort(
      (a, b) => ROLE_DEFINITIONS[b].rank - ROLE_DEFINITIONS[a].rank,
    );
    for (let index = 1; index < byRank.length; index += 1) {
      const higher = permissionsForRole(byRank[index - 1]!);
      for (const permission of permissionsForRole(byRank[index]!)) {
        expect(higher).toContain(permission);
      }
    }
  });

  it('keep member and settings management away from managers, staff and viewers', () => {
    for (const role of ['MANAGER', 'STAFF', 'VIEWER'] as const) {
      expect(hasPermissions(permissionsForRole(role), ['roles.assign'])).toBe(false);
      expect(hasPermissions(permissionsForRole(role), ['users.create'])).toBe(false);
      expect(hasPermissions(permissionsForRole(role), ['organizations.update'])).toBe(false);
    }
  });

  it('give viewers read-only access', () => {
    expect(permissionsForRole('VIEWER').every((permission) => permission.endsWith('.read'))).toBe(
      true,
    );
  });
});

describe('webhook resource permissions', () => {
  it('reserve secret reveal, API key changes and application archiving for owners and admins', () => {
    const admin = ['OWNER', 'ADMIN'] as const;
    for (const permission of [
      'endpoint_secrets.reveal',
      'api_keys.create',
      'api_keys.delete',
      'applications.delete',
    ] as const) {
      for (const role of admin) expect(permissionsForRole(role)).toContain(permission);
      for (const role of ['MANAGER', 'STAFF', 'VIEWER'] as const)
        expect(permissionsForRole(role), `${role} must not have ${permission}`).not.toContain(
          permission,
        );
    }
  });

  it('let managers run endpoints and event types but only read API keys', () => {
    const manager = permissionsForRole('MANAGER');
    expect(manager).toEqual(
      expect.arrayContaining(['endpoints.create', 'endpoints.update', 'event_types.create']),
    );
    expect(manager).toContain('api_keys.read');
    expect(permissionsForRole('STAFF')).not.toContain('api_keys.read');
  });
});

describe('hasPermissions', () => {
  it('requires every listed permission', () => {
    expect(hasPermissions(['users.read', 'users.create'], ['users.read', 'users.create'])).toBe(
      true,
    );
    expect(hasPermissions(['users.read'], ['users.read', 'users.create'])).toBe(false);
  });
});

describe('membership management rules', () => {
  it('lets owners manage everyone, including other owners', () => {
    for (const target of ROLE_KEYS) expect(canManageMember('OWNER', target)).toBe(true);
    expect(assignableRoles('OWNER')).toEqual(ROLE_KEYS);
  });

  it('stops admins from managing owners or peers, or granting admin', () => {
    expect(canManageMember('ADMIN', 'OWNER')).toBe(false);
    expect(canManageMember('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageMember('ADMIN', 'MANAGER')).toBe(true);
    expect(assignableRoles('ADMIN')).toEqual(['MANAGER', 'STAFF', 'VIEWER']);
  });

  it('gives viewers nothing to assign', () => {
    expect(assignableRoles('VIEWER')).toEqual([]);
  });
});
