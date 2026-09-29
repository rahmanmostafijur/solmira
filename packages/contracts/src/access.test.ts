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

describe('hasPermissions', () => {
  it('requires every listed permission', () => {
    expect(hasPermissions(['orders.read', 'orders.create'], ['orders.read', 'orders.create'])).toBe(
      true,
    );
    expect(hasPermissions(['orders.read'], ['orders.read', 'orders.create'])).toBe(false);
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
