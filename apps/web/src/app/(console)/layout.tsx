import type { ReactNode } from 'react';
import { RequireSession } from '@/components/auth/require-session';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import { LiveFeedBridge } from '@/components/webhooks/live-feed-bridge';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <LiveFeedBridge />
      <div className="flex min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          Skip to content
        </a>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="main" className="flex-1 px-4 py-6 sm:px-8">
            {children}
          </main>
        </div>
      </div>
    </RequireSession>
  );
}
