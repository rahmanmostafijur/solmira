import { Activity, type LucideIcon } from 'lucide-react';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** Only modules that exist are listed; each phase adds its section. */
export const NAVIGATION: readonly NavSection[] = [
  {
    title: 'Platform',
    items: [{ href: '/system/status', label: 'Service status', icon: Activity }],
  },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function findNavItem(pathname: string): { section: NavSection; item: NavItem } | undefined {
  for (const section of NAVIGATION) {
    const item = section.items.find((candidate) => isActive(pathname, candidate.href));
    if (item) return { section, item };
  }
  return undefined;
}
