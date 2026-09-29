import type { ReactNode } from 'react';
import { Wordmark } from '@/components/shell/sidebar';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Wordmark />
      </div>
      <main className="w-full max-w-sm">{children}</main>
      <p className="mt-10 text-xs text-ink-muted">Order, inventory and fulfillment operations</p>
    </div>
  );
}
