'use client';

import type { PurchaseReceipt } from '@solmira/contracts';
import { formatDateTime } from '@/components/catalog/labels';
import { Alert, EmptyState, LoadingRows } from '@/components/ui/feedback';
import { describeError } from '@/lib/api/client';
import { usePurchaseReceipts } from '@/lib/purchasing-queries';
import { formatUnits } from './labels';
import { usePersonName } from './use-person-name';

function ReceiptEntry({
  receipt,
  personName,
}: {
  receipt: PurchaseReceipt;
  personName: (userId: string | null) => string;
}) {
  const units = receipt.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <li className="space-y-2 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <time dateTime={receipt.receivedAt} className="font-medium">
            {formatDateTime(receipt.receivedAt)}
          </time>
          <span className="text-ink-muted">
            {' '}
            · {personName(receipt.receivedBy)} · into {receipt.warehouse.code}
          </span>
        </p>
        <span className="text-xs text-ink-muted tabular-nums">
          {formatUnits(units)} unit{units === 1 ? '' : 's'} ·{' '}
          <span className="font-mono">{receipt.id.slice(0, 8)}</span>
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {receipt.lines.map((line) => (
          <li
            key={line.id}
            className="rounded-md bg-canvas px-2 py-1 text-xs ring-1 ring-line ring-inset"
            title={line.variantName}
          >
            <span className="font-mono font-medium">{line.sku}</span>{' '}
            <span className="tabular-nums">× {formatUnits(line.quantity)}</span>
          </li>
        ))}
      </ul>
      {receipt.note && <p className="text-ink-muted">{receipt.note}</p>}
    </li>
  );
}

/** Every receipt against the order, newest first. Receipts are never edited. */
export function ReceiptHistory({
  organizationId,
  purchaseOrderId,
}: {
  organizationId: string;
  purchaseOrderId: string;
}) {
  const receipts = usePurchaseReceipts(organizationId, purchaseOrderId);
  const personName = usePersonName(organizationId);
  if (receipts.isPending) return <LoadingRows label="Loading receipts" />;
  if (receipts.isError) {
    return (
      <div className="p-4">
        <Alert tone="error">{describeError(receipts.error)}</Alert>
      </div>
    );
  }
  if (receipts.data.length === 0) {
    return (
      <EmptyState
        title="Nothing received yet"
        description="Each delivery recorded against this order appears here with its lines."
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {receipts.data.map((receipt) => (
        <ReceiptEntry key={receipt.id} receipt={receipt} personName={personName} />
      ))}
    </ul>
  );
}
