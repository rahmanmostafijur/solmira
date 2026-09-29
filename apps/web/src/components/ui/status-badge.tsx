import clsx from 'clsx';
import type { ServiceState } from '@/lib/service-status';

const APPEARANCE: Record<ServiceState, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'bg-ok-soft text-ok ring-ok/20' },
  degraded: { label: 'Degraded', className: 'bg-warn-soft text-warn ring-warn/25' },
  unreachable: { label: 'Unreachable', className: 'bg-danger-soft text-danger ring-danger/20' },
};

export function StatusBadge({ state }: { state: ServiceState }) {
  const { label, className } = APPEARANCE[state];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
