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
  'products.read': 'View products and variants',
  'products.create': 'Create products and variants',
  'products.update': 'Edit products and variants',
  'products.delete': 'Archive products and variants',
  'suppliers.read': 'View suppliers',
  'suppliers.manage': 'Create and edit suppliers',
  'warehouses.read': 'View warehouses',
  'warehouses.manage': 'Create and edit warehouses',
  'inventory.read': 'View stock levels and movements',
  'inventory.adjust': 'Adjust and transfer stock',
  'inventory.reserve': 'Reserve and release stock',
  'purchase_orders.read': 'View purchase orders',
  'purchase_orders.create': 'Create and submit purchase orders',
  'purchase_orders.approve': 'Approve or cancel purchase orders',
  'purchase_orders.receive': 'Receive stock against purchase orders',
  'orders.read': 'View customer orders',
  'orders.create': 'Create customer orders',
  'orders.update': 'Update and progress customer orders',
  'orders.cancel': 'Cancel customer orders',
  'shipments.read': 'View shipments',
  'shipments.create': 'Create shipments',
  'shipments.update': 'Update shipment status',
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
  'products.read',
  'suppliers.read',
  'warehouses.read',
  'inventory.read',
  'purchase_orders.read',
  'orders.read',
  'shipments.read',
  'analytics.read',
];

const MANAGE_OPERATIONS: readonly Permission[] = [
  ...READ_OPERATIONS,
  'users.read',
  'roles.read',
  'products.create',
  'products.update',
  'products.delete',
  'suppliers.manage',
  'warehouses.manage',
  'inventory.adjust',
  'inventory.reserve',
  'purchase_orders.create',
  'purchase_orders.approve',
  'purchase_orders.receive',
  'orders.create',
  'orders.update',
  'orders.cancel',
  'shipments.create',
  'shipments.update',
  'audit_logs.read',
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
    description: 'Manages members, roles, settings and all operational data',
    rank: 40,
    permissions: PERMISSIONS,
  },
  MANAGER: {
    key: 'MANAGER',
    name: 'Operations manager',
    description: 'Runs day-to-day operations; cannot manage members or settings',
    rank: 30,
    permissions: MANAGE_OPERATIONS,
  },
  STAFF: {
    key: 'STAFF',
    name: 'Staff',
    description: 'Processes orders, stock and shipments',
    rank: 20,
    permissions: [
      ...READ_OPERATIONS,
      'inventory.adjust',
      'inventory.reserve',
      'purchase_orders.receive',
      'orders.create',
      'orders.update',
      'shipments.create',
      'shipments.update',
    ],
  },
  VIEWER: {
    key: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to operational data',
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
