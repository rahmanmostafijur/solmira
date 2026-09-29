/** Pages for signed-out visitors; signed-in users are sent on to the app. */
export const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'] as const;

/** Reachable with or without a session (they handle both cases themselves). */
const OPEN_PAGES = ['/verify-email', '/accept-invitation'] as const;

export const DEFAULT_SIGNED_IN_PATH = '/dashboard';

export type RouteDecision =
  { readonly action: 'continue' } | { readonly action: 'redirect'; readonly to: string };

const matches = (pathname: string, pages: readonly string[]) =>
  pages.some((page) => pathname === page || pathname.startsWith(`${page}/`));

/**
 * Optimistic routing from the session hint cookie. This is a user-experience shortcut only:
 * the hint cookie grants nothing, and every API call is authorised by the backend.
 */
export function decideRoute(
  pathname: string,
  search: string,
  hasSessionHint: boolean,
): RouteDecision {
  if (matches(pathname, AUTH_PAGES)) {
    return hasSessionHint
      ? { action: 'redirect', to: DEFAULT_SIGNED_IN_PATH }
      : { action: 'continue' };
  }
  if (matches(pathname, OPEN_PAGES) || hasSessionHint) return { action: 'continue' };
  return { action: 'redirect', to: `/login?next=${encodeURIComponent(pathname + search)}` };
}

/**
 * Accepts only same-site relative paths as post-login destinations. Anything else ("//evil.com",
 * "https://evil.com", "javascript:") falls back to the dashboard: no open redirects.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return DEFAULT_SIGNED_IN_PATH;
  }
  return next;
}
