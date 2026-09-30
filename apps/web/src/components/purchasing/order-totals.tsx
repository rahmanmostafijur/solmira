import type { OrderTotals } from '@solmira/contracts';
import { formatMoney } from '@/lib/money';

/** Subtotal, tax, shipping and total of an order, as saved or as a live preview. */
export function OrderTotalsSummary({
  totals,
  currency,
  note,
}: {
  totals: OrderTotals;
  currency: string;
  /** Shown under the total, e.g. that the server recalculates a preview. */
  note?: string;
}) {
  const rows = [
    { label: 'Subtotal', value: totals.subtotal },
    { label: 'Tax', value: totals.tax },
    { label: 'Shipping', value: totals.shippingCost },
  ];
  return (
    <div className="ml-auto w-full max-w-xs text-sm">
      <dl className="space-y-1.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="tabular-nums">{formatMoney(value, currency)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(totals.total, currency)}</dd>
        </div>
      </dl>
      {note && <p className="mt-2 text-xs text-ink-muted">{note}</p>}
    </div>
  );
}
