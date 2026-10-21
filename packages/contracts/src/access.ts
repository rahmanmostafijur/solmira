import { z } from 'zod';

/**
 * The permission catalog. It is the single source of truth: identity-service syncs it into the
 * `permissions` table, guards check against it, and the web app uses it to shape the UI.
 * Adding a feature means adding its permissions here, never checking role names in controllers.
 */
export const PERMISSION_CATALOG = {
  'organizations.read': 'View organization profile and settings',
  'organizations.update': 'Change organization profile and settings',
  'users.read': 'View members of the organization',
  'users.create': 'Invite people to the organization',
  'users.update': 'Suspend or reactivate members',
  'users.delete': 'Remove members from the organization',
  'roles.read': 'View roles and their permissions',
  'roles.assign': 'Change the role of a member',
  'applications.read': 'View applications',
  'applications.create': 'Create applications',
  'applications.update': 'Edit applications',
  'applications.delete': 'Archive and restore applications',
  'api_keys.read': 'View API keys (never the key itself)',
  'api_keys.create': 'Create API keys',
  'api_keys.delete': 'Revoke API keys',
  'event_types.read': 'View event types',
  'event_types.create': 'Create event types',
  'event_types.update': 'Edit event types',
  'event_types.delete': 'Archive event types',
  'endpoints.read': 'View endpoints',
  'endpoints.create': 'Create endpoints',
  'endpoints.update': 'Edit endpoints',
  'endpoints.delete': 'Archive endpoints',
  'endpoint_secrets.reveal': 'Reveal endpoint signing secrets (audited)',
  'endpoint_secrets.rotate': 'Rotate endpoint signing secrets (audited)',
  'deliveries.replay': 'Replay messages and failed deliveries',
  'notifications.read': 'View and acknowledge notifications',
  'analytics.read': 'View dashboards and reports',
  'audit_logs.read': 'View the audit trail',
} as const;

export type Permission = keyof typeof PERMISSION_CATALOG;
export const PERMISSIONS = Object.keys(PERMISSION_CATALOG) as Permission[];
export const permissionSchema = z.enum(PERMISSIONS as [Permission, ...Permission[]]);

export const ROLE_KEYS = ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const roleKeySchema = z.enum(ROLE_KEYS);

const READ_OPERATIONS: readonly Permission[] = [
  'organizations.read',
  'analytics.read',
  'notifications.read',
  'applications.read',
  'event_types.read',
  'endpoints.read',
];

const MANAGE_OPERATIONS: readonly Permission[] = [
  ...READ_OPERATIONS,
  'users.read',
  'roles.read',
  'audit_logs.read',
  'api_keys.read',
  'applications.create',
  'applications.update',
  'event_types.create',
  'event_types.update',
  'event_types.delete',
  'endpoints.create',
  'endpoints.update',
  'endpoints.delete',
  'deliveries.replay',
];

export interface RoleDefinition {
  readonly key: RoleKey;
  readonly name: string;
  readonly description: string;
  /** Higher rank can manage lower rank. Used for assignment rules, never for access checks. */
  readonly rank: number;
  readonly permissions: readonly Permission[];
}

export const ROLE_DEFINITIONS: Readonly<Record<RoleKey, RoleDefinition>> = {
  OWNER: {
    key: 'OWNER',
    name: 'Owner',
    description: 'Full control, including other owners and administrators',
    rank: 50,
    permissions: PERMISSIONS,
  },
  ADMIN: {
    key: 'ADMIN',
    name: 'Administrator',
    description: 'Manages members, roles, settings and all webhook resources',
    rank: 40,
    permissions: PERMISSIONS,
  },
  MANAGER: {
    key: 'MANAGER',
    name: 'Manager',
    description:
      'Manages event types and endpoints; cannot manage members, API keys, secrets or settings',
    rank: 30,
    permissions: MANAGE_OPERATIONS,
  },
  STAFF: {
    key: 'STAFF',
    name: 'Staff',
    description: 'Views applications, event types and endpoints',
    rank: 20,
    permissions: READ_OPERATIONS,
  },
  VIEWER: {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access',
    rank: 10,
    permissions: READ_OPERATIONS,
  },
};

export function permissionsForRole(role: RoleKey): readonly Permission[] {
  return ROLE_DEFINITIONS[role].permissions;
}

export function hasPermissions(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.every((permission) => granted.includes(permission));
}

/**
 * Membership management rules, shared so the UI can hide what the API would reject. The API
 * enforces the same functions; the UI copy is a convenience only.
 *
 * - Owners can manage anyone, including other owners.
 * - Everyone else can only manage members ranked strictly below themselves.
 */
export function canManageMember(actor: RoleKey, target: RoleKey): boolean {
  if (actor === 'OWNER') return true;
  return ROLE_DEFINITIONS[actor].rank > ROLE_DEFINITIONS[target].rank;
}

/** Roles an actor may grant: owners grant any role; others only roles ranked below their own. */
export function assignableRoles(actor: RoleKey): readonly RoleKey[] {
  if (actor === 'OWNER') return ROLE_KEYS;
  const actorRank = ROLE_DEFINITIONS[actor].rank;
  return ROLE_KEYS.filter((role) => ROLE_DEFINITIONS[role].rank < actorRank);
}
