import type { InventoryLevel } from '@solmira/contracts';

const units = (n: number) => n.toLocaleString('en');

/** The stock line a dialog acts on, with its current balances. */
export function StockSummary({ level }: { level: InventoryLevel }) {
  return (
    <div className="rounded-md border border-line bg-canvas px-4 py-3 text-sm">
      <p className="font-medium">
        <span className="font-mono text-xs">{level.item.sku}</span> · {level.item.productName}
        {level.item.variantName !== level.item.productName && ` · ${level.item.variantName}`}
      </p>
      <p className="text-xs text-ink-muted">
        {level.warehouse.code} · {level.warehouse.name}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: 'On hand', value: level.onHand },
          { label: 'Reserved', value: level.reserved },
          { label: 'Available', value: level.available },
        ].map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{units(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
