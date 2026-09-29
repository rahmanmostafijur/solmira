import type { ReactNode } from 'react';

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface px-6 py-7 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="text-center text-sm text-ink-muted">{footer}</div>}
    </div>
  );
}
