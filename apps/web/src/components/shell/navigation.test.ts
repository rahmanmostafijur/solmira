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

  it('hides organization settings when no organization is active', () => {
    const labels = visibleSections(() => true, false).flatMap((section) =>
      section.items.map((item) => item.label),
    );
    expect(labels).not.toContain('General');
    expect(labels).toContain('Organizations');
  });

  it('selects Applications for nested webhook pages', () => {
    expect(findNavItem('/applications/abc/endpoints/def')?.item.label).toBe('Applications');
    expect(findNavItem('/event-types')?.item.label).toBe('Event types');
  });

  it('shows webhook pages only with the matching permissions', () => {
    const labels = visibleSections((permission) => permission === 'event_types.read', true).flatMap(
      (section) => section.items.map((item) => item.label),
    );
    expect(labels).toContain('Event types');
    expect(labels).not.toContain('Applications');
  });
});
