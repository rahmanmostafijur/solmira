import type { Permission } from '@solmira/contracts';
import {
  Activity,
  AppWindow,
  Building2,
  LayoutDashboard,
  ScrollText,
  Tags,
  ShieldCheck,
  SlidersHorizontal,
  Users,
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
    title: 'Webhooks',
    items: [
      {
        href: '/applications',
        label: 'Applications',
        icon: AppWindow,
        permission: 'applications.read',
        requiresOrganization: true,
      },
      {
        href: '/event-types',
        label: 'Event types',
        icon: Tags,
        permission: 'event_types.read',
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
        href: '/settings/audit-log',
        label: 'Audit log',
        icon: ScrollText,
        permission: 'audit_logs.read',
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
