'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from './auth-provider';

function ConsoleSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading your workspace">
      <div className="hidden w-60 border-r border-line bg-surface lg:block" />
      <div className="flex-1 space-y-4 p-8">
        <div className="h-6 w-48 animate-pulse rounded bg-line" />
        <div className="h-32 animate-pulse rounded-lg bg-line/60" />
      </div>
    </div>
  );
}

/** Client-side gate for the console. The proxy already routed; this handles expired sessions. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== 'authenticated') return <ConsoleSkeleton />;
  return <>{children}</>;
}
