import type { Permission } from '@solmira/contracts';
import {
  Activity,
  BookmarkCheck,
  Boxes,
  Building2,
  ClipboardList,
  FolderTree,
  History,
  LayoutDashboard,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Hidden unless the active organization grants this. UX only; the API enforces access. */
  readonly permission?: Permission;
  readonly requiresOrganization?: boolean;
}

export interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

export const NAVIGATION: readonly NavSection[] = [
  {
    title: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/organizations', label: 'Organizations', icon: Building2 },
    ],
  },
  {
    title: 'Catalog',
    items: [
      {
        href: '/products',
        label: 'Products',
        icon: Package,
        permission: 'products.read',
        requiresOrganization: true,
      },
      {
        href: '/categories',
        label: 'Categories',
        icon: FolderTree,
        permission: 'categories.read',
        requiresOrganization: true,
      },
      {
        href: '/suppliers',
        label: 'Suppliers',
        icon: Truck,
        permission: 'suppliers.read',
        requiresOrganization: true,
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        href: '/warehouses',
        label: 'Warehouses',
        icon: Warehouse,
        permission: 'warehouses.read',
        requiresOrganization: true,
      },
      {
        href: '/inventory',
        label: 'Inventory',
        icon: Boxes,
        permission: 'inventory.read',
        requiresOrganization: true,
      },
      {
        href: '/inventory/movements',
        label: 'Stock movements',
        icon: History,
        permission: 'inventory.read',
        requiresOrganization: true,
      },
      {
        href: '/inventory/reservations',
        label: 'Reservations',
        icon: BookmarkCheck,
        permission: 'inventory.read',
        requiresOrganization: true,
      },
      {
        href: '/purchase-orders',
        label: 'Purchase orders',
        icon: ClipboardList,
        permission: 'purchase_orders.read',
        requiresOrganization: true,
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        href: '/settings',
        label: 'General',
        icon: SlidersHorizontal,
        permission: 'organizations.read',
        requiresOrganization: true,
      },
      {
        href: '/settings/members',
        label: 'Members',
        icon: Users,
        permission: 'users.read',
        requiresOrganization: true,
      },
      {
        href: '/settings/roles',
        label: 'Roles',
        icon: ShieldCheck,
        permission: 'roles.read',
        requiresOrganization: true,
      },
    ],
  },
  {
    title: 'Platform',
    items: [{ href: '/system/status', label: 'Service status', icon: Activity }],
  },
];

const allItems = () =>
  NAVIGATION.flatMap((section) => section.items.map((item) => ({ section, item })));

/** The most specific item for a path: /settings/members selects Members, not General. */
export function findNavItem(pathname: string): { section: NavSection; item: NavItem } | undefined {
  return allItems()
    .filter(({ item }) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.item.href.length - a.item.href.length)[0];
}

export function isActive(pathname: string, href: string): boolean {
  return findNavItem(pathname)?.item.href === href;
}

export function visibleSections(
  can: (permission: Permission) => boolean,
  hasOrganization: boolean,
): readonly NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (!item.requiresOrganization || hasOrganization) &&
        (!item.permission || can(item.permission)),
    ),
  })).filter((section) => section.items.length > 0);
}
