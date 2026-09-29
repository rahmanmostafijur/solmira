import clsx from 'clsx';
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-muted ring-line',
  accent: 'bg-accent-soft text-accent ring-accent/20',
  ok: 'bg-ok-soft text-ok ring-ok/20',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  danger: 'bg-danger-soft text-danger ring-danger/20',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
