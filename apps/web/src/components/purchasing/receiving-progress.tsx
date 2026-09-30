import type { ReceivingSummary } from '@solmira/contracts';
import { formatDateTime } from '@/components/catalog/labels';
import { formatUnits, receivedPercent } from './labels';

/** Received against ordered units, as a bar and in words. */
export function ReceivingProgress({ receiving }: { receiving: ReceivingSummary }) {
  const percent = receivedPercent(receiving);
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-medium tabular-nums">{formatUnits(receiving.receivedUnits)}</span>
          <span className="text-ink-muted">
            {' '}
            of {formatUnits(receiving.orderedUnits)} units received
          </span>
        </span>
        <span className="text-xs text-ink-muted tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Units received"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line ring-inset"
      >
        <div
          className={`h-full rounded-full ${percent === 100 ? 'bg-ok' : 'bg-accent'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-ink-muted">
        {formatUnits(receiving.remainingUnits)} remaining · {receiving.receiptCount} receipt
        {receiving.receiptCount === 1 ? '' : 's'}
        {receiving.lastReceivedAt && ` · last ${formatDateTime(receiving.lastReceivedAt)}`}
      </p>
    </div>
  );
}
