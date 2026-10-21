'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/components/auth/auth-provider';
import { ToastProvider } from '@/components/ui/toast';
import { queryRetryDelay, shouldRetryQuery } from '@/lib/api/retry-policy';

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session; created lazily so server renders never share cache between users.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // A service restarting behind the gateway is waited out; 4xx answers fail fast.
            retry: shouldRetryQuery,
            retryDelay: queryRetryDelay,
          },
          // Not every mutation is idempotent: a person decides whether to send one again.
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
