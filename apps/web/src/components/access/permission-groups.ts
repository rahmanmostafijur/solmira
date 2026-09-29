import { PERMISSION_CATALOG, type Permission } from '@solmira/contracts';

const AREA_LABELS: Record<string, string> = {
  organizations: 'Organization',
  users: 'Members',
  roles: 'Roles',
  products: 'Products',
  categories: 'Categories',
  suppliers: 'Suppliers',
  warehouses: 'Warehouses',
  inventory: 'Inventory',
  purchase_orders: 'Purchase orders',
  orders: 'Customer orders',
  shipments: 'Shipments',
  analytics: 'Analytics',
  audit_logs: 'Audit trail',
};

export interface PermissionGroup {
  readonly area: string;
  readonly label: string;
  readonly permissions: readonly { key: Permission; description: string }[];
}

/** The catalog grouped by area ("orders.cancel" belongs to "orders"), in catalog order. */
export function permissionGroups(): readonly PermissionGroup[] {
  const groups = new Map<string, { key: Permission; description: string }[]>();
  for (const [key, description] of Object.entries(PERMISSION_CATALOG)) {
    const area = key.split('.')[0]!;
    groups.set(area, [...(groups.get(area) ?? []), { key: key as Permission, description }]);
  }
  return [...groups].map(([area, permissions]) => ({
    area,
    label: AREA_LABELS[area] ?? area,
    permissions,
  }));
}
