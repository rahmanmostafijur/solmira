'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const MAX_RETRIES = 2;

/** 4xx responses will not succeed on retry (bad input, missing permission), so fail fast. */
function isClientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const { status } = error as { status: unknown };
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function Providers({ children }: { children: ReactNode }) {
  // One client per browser session; created lazily so server renders never share cache between users.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => failureCount < MAX_RETRIES && !isClientError(error),
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
