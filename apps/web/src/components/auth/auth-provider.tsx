'use client';

import type { AuthSession, LoginRequest, RegisterRequest } from '@solmira/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { api, refreshSession, sessionStore, type SessionState } from '@/lib/auth/session-store';

interface AuthActions {
  login(input: LoginRequest): Promise<AuthSession>;
  register(input: RegisterRequest): Promise<AuthSession>;
  logout(): Promise<void>;
  switchOrganization(organizationId: string): Promise<AuthSession>;
  /** Re-reads the session from the server, e.g. after joining an organization. */
  reload(): Promise<AuthSession | null>;
}

const AuthContext = createContext<(SessionState & AuthActions) | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot,
  );
  const queryClient = useQueryClient();

  // Restore the session from the refresh cookie once per page load.
  useEffect(() => {
    void refreshSession().then((session) => sessionStore.set(session));
  }, []);

  /** A new identity or tenant must never see cached data from the previous one. */
  const adopt = useCallback(
    (session: AuthSession | null) => {
      queryClient.clear();
      sessionStore.set(session);
    },
    [queryClient],
  );

  const actions = useMemo<AuthActions>(
    () => ({
      async login(input) {
        const session = await api<AuthSession>('/auth/login', {
          method: 'POST',
          body: input,
          authenticated: false,
        });
        adopt(session);
        return session;
      },
      async register(input) {
        const session = await api<AuthSession>('/auth/register', {
          method: 'POST',
          body: input,
          authenticated: false,
        });
        adopt(session);
        return session;
      },
      async logout() {
        try {
          await api<void>('/auth/logout', { method: 'POST', authenticated: false });
        } finally {
          adopt(null);
        }
      },
      async switchOrganization(organizationId) {
        const session = await api<AuthSession>('/auth/switch-organization', {
          method: 'POST',
          body: { organizationId },
        });
        adopt(session);
        return session;
      },
      async reload() {
        const session = await refreshSession();
        adopt(session);
        return session;
      },
    }),
    [adopt],
  );

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
