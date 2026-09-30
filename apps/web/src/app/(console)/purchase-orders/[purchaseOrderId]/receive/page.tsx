'use client';

import {
  isPurchaseOrderReceivable,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
  type PurchaseReceiptResult,
} from '@solmira/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { formatDateTime } from '@/components/catalog/labels';
import { formatUnits } from '@/components/purchasing/labels';
import { ReceiveForm } from '@/components/purchasing/receive-form';
import { ReceivingProgress } from '@/components/purchasing/receiving-progress';
import { PurchaseOrderStatusBadge } from '@/components/purchasing/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { ApiError, describeError } from '@/lib/api/client';
import { usePurchaseOrder } from '@/lib/purchasing-queries';

const LINK = 'text-sm font-medium text-accent hover:underline';

const NOT_RECEIVABLE: Partial<Record<PurchaseOrderStatus, { title: string; description: string }>> =
  {
    DRAFT: {
      title: 'This order is still a draft',
      description: 'Submit it and have it approved before receiving stock against it.',
    },
    SUBMITTED: {
      title: 'This order is awaiting approval',
      description: 'Stock can be received once someone approves the order.',
    },
    RECEIVED: {
      title: 'Everything on this order has been received',
      description: 'There is nothing left to receive. Its receipts are listed on the order.',
    },
    CANCELLED: {
      title: 'This order was cancelled',
      description: 'A cancelled order cannot be received. Anything received before stays in stock.',
    },
  };

function ReceiptDone({
  result,
  onAnother,
}: {
  result: PurchaseReceiptResult;
  onAnother: () => void;
}) {
  const { receipt, purchaseOrder, replayed } = result;
  const units = receipt.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Panel
      title={replayed ? 'This receipt was already recorded' : 'Receipt recorded'}
      description={
        replayed
          ? 'The server already had this receipt from an earlier attempt, so nothing was received twice.'
          : `${formatUnits(units)} unit${units === 1 ? '' : 's'} added to ${receipt.warehouse.code} · ${receipt.warehouse.name}.`
      }
      actions={<PurchaseOrderStatusBadge status={purchaseOrder.status} />}
    >
      <div className="space-y-4 p-5 text-sm">
        {replayed && (
          <Alert tone="info">
            This receipt was already recorded. The details below are the original receipt.
          </Alert>
        )}
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Receipt</dt>
            <dd className="mt-0.5 font-mono text-xs">{receipt.id}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Received</dt>
            <dd className="mt-0.5">
              <time dateTime={receipt.receivedAt}>{formatDateTime(receipt.receivedAt)}</time>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Order status now</dt>
            <dd className="mt-0.5">
              <PurchaseOrderStatusBadge status={purchaseOrder.status} />
            </dd>
          </div>
        </dl>
        <ul className="divide-y divide-line rounded-md border border-line">
          {receipt.lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="font-mono text-xs font-medium">{line.sku}</span>{' '}
                <span className="text-ink-muted">{line.variantName}</span>
              </span>
              <span className="font-medium tabular-nums">{formatUnits(line.quantity)}</span>
            </li>
          ))}
        </ul>
        {receipt.note && <p className="text-ink-muted">Note: {receipt.note}</p>}
        <ReceivingProgress receiving={purchaseOrder.receiving} />
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Link href={`/purchase-orders/${purchaseOrder.id}`} className={LINK}>
            Back to {purchaseOrder.number}
          </Link>
          {isPurchaseOrderReceivable(purchaseOrder.status) && (
            <Button variant="secondary" size="sm" onClick={onAnother}>
              Record another receipt
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ReceiveBody({
  organizationId,
  order,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
}) {
  const { can } = usePermissions();
  const [result, setResult] = useState<PurchaseReceiptResult | null>(null);

  if (result) return <ReceiptDone result={result} onAnother={() => setResult(null)} />;
  if (!isPurchaseOrderReceivable(order.status)) {
    const reason = NOT_RECEIVABLE[order.status];
    return (
      <Panel>
        <EmptyState
          title={reason?.title ?? 'This order cannot be received'}
          description={reason?.description}
          action={
            <Link href={`/purchase-orders/${order.id}`} className={LINK}>
              Open {order.number}
            </Link>
          }
        />
      </Panel>
    );
  }
  if (!can('purchase_orders.receive')) {
    return (
      <Alert tone="warning" title="You cannot receive stock">
        Your role does not include receiving purchase orders. Ask an owner or admin if you need it.
      </Alert>
    );
  }
  return <ReceiveForm organizationId={organizationId} order={order} onReceived={setResult} />;
}

function ReceiveView({
  organizationId,
  purchaseOrderId,
}: {
  organizationId: string;
  purchaseOrderId: string;
}) {
  const query = usePurchaseOrder(organizationId, purchaseOrderId);

  if (query.isPending) return <LoadingRows rows={6} label="Loading purchase order" />;
  if (query.isError) {
    return query.error instanceof ApiError &&
      (query.error.status === 404 || query.error.status === 400) ? (
      <EmptyState
        title="Purchase order not found"
        action={
          <Link href="/purchase-orders" className={LINK}>
            Back to purchase orders
          </Link>
        }
      />
    ) : (
      <Alert tone="error">{describeError(query.error)}</Alert>
    );
  }
  const order = query.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="mb-2 text-sm">
          <Link href={`/purchase-orders/${order.id}`} className="text-ink-muted hover:text-ink">
            ← {order.number}
          </Link>
        </p>
        <PageHeader
          title={`Receive ${order.number}`}
          description="Record what arrived. Each receipt adds stock to the order's warehouse and is kept on the order."
          actions={<PurchaseOrderStatusBadge status={order.status} />}
        />
      </div>
      <Panel>
        <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-muted">Supplier</dt>
            <dd className="mt-0.5 font-medium">{order.supplier.companyName}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Receiving into</dt>
            <dd className="mt-0.5 font-medium">
              {order.warehouse.code} · {order.warehouse.name}
            </dd>
          </div>
        </dl>
        <div className="border-t border-line px-5 py-4">
          <ReceivingProgress receiving={order.receiving} />
        </div>
      </Panel>
      <ReceiveBody organizationId={organizationId} order={order} />
    </div>
  );
}

export default function ReceivePurchaseOrderPage() {
  const { purchaseOrderId } = useParams<{ purchaseOrderId: string }>();
  return (
    <RequireOrganization permission="purchase_orders.read">
      {(organization) => (
        <ReceiveView organizationId={organization.id} purchaseOrderId={purchaseOrderId} />
      )}
    </RequireOrganization>
  );
}
