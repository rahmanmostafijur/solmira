import { describe, expect, it } from 'vitest';
import { decideRoute, safeNextPath } from './routing';

describe('decideRoute', () => {
  it('sends signed-out visitors of app pages to login, remembering where they were going', () => {
    expect(decideRoute('/settings/members', '?tab=pending', false)).toEqual({
      action: 'redirect',
      to: '/login?next=%2Fsettings%2Fmembers%3Ftab%3Dpending',
    });
  });

  it('lets signed-in users through to app pages', () => {
    expect(decideRoute('/dashboard', '', true)).toEqual({ action: 'continue' });
  });

  it('sends signed-in users away from login and registration', () => {
    expect(decideRoute('/login', '', true)).toEqual({ action: 'redirect', to: '/dashboard' });
    expect(decideRoute('/register', '', false)).toEqual({ action: 'continue' });
  });

  it('keeps invitation and verification links open in both states', () => {
    expect(decideRoute('/accept-invitation', '?token=x', false)).toEqual({ action: 'continue' });
    expect(decideRoute('/verify-email', '?token=x', true)).toEqual({ action: 'continue' });
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/settings/members', '/settings/members'],
    [null, '/dashboard'],
    ['https://evil.example/phish', '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['javascript:alert(1)', '/dashboard'],
  ])('maps %j to %j', (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});
