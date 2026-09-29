'use client';

import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useTransition } from 'react';

const AUTO_REFRESH_MS = 15_000;

/** Re-runs the server component on an interval; the probe itself stays on the server. */
export function RefreshControl({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  useEffect(() => {
    const timer = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex items-center gap-3 text-xs text-ink-muted">
      <span aria-live="polite">
        Checked{' '}
        <time dateTime={checkedAt} suppressHydrationWarning>
          {new Date(checkedAt).toLocaleTimeString()}
        </time>
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 font-medium text-ink hover:bg-canvas disabled:opacity-60"
      >
        <RefreshCw aria-hidden className={clsx('size-3.5', isPending && 'animate-spin')} />
        Refresh
      </button>
    </div>
  );
}
