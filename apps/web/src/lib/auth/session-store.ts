import { API_PREFIX, CLIENT_HEADER, authSessionSchema, type AuthSession } from '@solmira/contracts';
import { createApiClient } from '../api/client';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  readonly status: SessionStatus;
  readonly session: AuthSession | null;
}

/**
 * The access token lives here, in memory only: never in localStorage, where any injected script
 * could read it. A reload loses it on purpose and the refresh cookie restores it.
 */
const LOADING: SessionState = { status: 'loading', session: null };
let state: SessionState = LOADING;
const listeners = new Set<() => void>();

export const sessionStore = {
  getSnapshot: (): SessionState => state,
  // React requires a stable value here; a fresh object per call is treated as an infinite loop.
  getServerSnapshot: (): SessionState => LOADING,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(session: AuthSession | null): void {
    state = { status: session ? 'authenticated' : 'anonymous', session };
    listeners.forEach((listener) => listener());
  },
};

let inFlight: Promise<AuthSession | null> | null = null;

/**
 * Single-flight refresh. Within a tab, concurrent callers share one request. Across tabs, the
 * Web Locks API serialises refreshes, so two tabs never present the same refresh token (which
 * the server would treat as theft and answer by revoking the session).
 */
export function refreshSession(): Promise<AuthSession | null> {
  inFlight ??= withRefreshLock(async () => {
    const response = await fetch(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { [CLIENT_HEADER]: 'web' },
      credentials: 'same-origin',
    }).catch(() => null);
    if (!response?.ok) return null;
    const parsed = authSessionSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    return navigator.locks.request('solmira-auth-refresh', work);
  }
  return work();
}

export const api = createApiClient({
  getAccessToken: () => state.session?.accessToken ?? null,
  refreshAccessToken: async () => {
    const session = await refreshSession();
    sessionStore.set(session);
    return session?.accessToken ?? null;
  },
});
