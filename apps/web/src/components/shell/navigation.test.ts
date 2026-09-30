import { describe, expect, it } from 'vitest';
import { findNavItem, isActive, visibleSections } from './navigation';

describe('navigation', () => {
  it('selects the most specific item', () => {
    expect(findNavItem('/settings/members')?.item.label).toBe('Members');
    expect(findNavItem('/settings')?.item.label).toBe('General');
    expect(isActive('/settings/members', '/settings')).toBe(false);
  });

  it('hides items the active organization does not grant', () => {
    const viewer = visibleSections((permission) => permission === 'organizations.read', true);
    const labels = viewer.flatMap((section) => section.items.map((item) => item.label));

    expect(labels).toContain('General');
    expect(labels).not.toContain('Members');
    expect(labels).not.toContain('Roles');
  });

  it('shows catalog pages by read permission and hides them without an organization', () => {
    const labelsFor = (granted: readonly string[], hasOrganization = true) =>
      visibleSections((permission) => granted.includes(permission), hasOrganization).flatMap(
        (section) => section.items.map((item) => item.label),
      );

    expect(labelsFor(['products.read', 'categories.read'])).toEqual(
      expect.arrayContaining(['Products', 'Categories']),
    );
    expect(labelsFor(['products.read'])).not.toContain('Suppliers');
    expect(labelsFor(['warehouses.read'])).toContain('Warehouses');
    expect(labelsFor(['products.read', 'warehouses.read'], false)).not.toContain('Products');
    expect(findNavItem('/products/0192f000-0000-7000-8000-000000000000')?.item.label).toBe(
      'Products',
    );
  });

  it('shows inventory pages by inventory.read and selects the most specific one', () => {
    const operations = visibleSections((permission) => permission === 'inventory.read', true).find(
      (section) => section.title === 'Operations',
    );
    expect(operations?.items.map((item) => item.label)).toEqual([
      'Inventory',
      'Stock movements',
      'Reservations',
    ]);
    expect(findNavItem('/inventory/movements')?.item.label).toBe('Stock movements');
    expect(findNavItem('/inventory/reservations')?.item.label).toBe('Reservations');
    expect(findNavItem('/inventory')?.item.label).toBe('Inventory');
    expect(isActive('/inventory/movements', '/inventory')).toBe(false);
  });

  it('shows purchase orders by purchase_orders.read under Operations', () => {
    const operations = (granted: readonly string[]) =>
      visibleSections((permission) => granted.includes(permission), true)
        .find((section) => section.title === 'Operations')
        ?.items.map((item) => item.label) ?? [];

    expect(operations(['purchase_orders.read'])).toEqual(['Purchase orders']);
    expect(operations(['inventory.read'])).not.toContain('Purchase orders');
    expect(operations(['inventory.read', 'purchase_orders.read'])).toContain('Purchase orders');
    expect(findNavItem('/purchase-orders/0192f000-0000-7000-8000-000000000000')?.item.label).toBe(
      'Purchase orders',
    );
    expect(findNavItem('/purchase-orders/new')?.item.label).toBe('Purchase orders');
  });

  it('hides organization settings when no organization is active', () => {
    const labels = visibleSections(() => true, false).flatMap((section) =>
      section.items.map((item) => item.label),
    );
    expect(labels).not.toContain('General');
    expect(labels).toContain('Organizations');
  });
});
