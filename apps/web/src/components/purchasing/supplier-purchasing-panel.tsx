'use client';

import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
  type SupplierPurchasingSummary,
} from '@solmira/contracts';
import Link from 'next/link';
import { formatDate } from '@/components/catalog/labels';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { describeError } from '@/lib/api/client';
import { formatMoney } from '@/lib/money';
import { usePurchaseOrders, useSupplierPurchasingSummary } from '@/lib/purchasing-queries';
import { PURCHASE_ORDER_STATUS_LABELS, onTimeRate } from './labels';
import { PurchaseOrderStatusBadge } from './status-badge';

const RECENT_ORDERS = 10;
const LINK = 'text-sm font-medium text-accent hover:underline';

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-ink-muted">{hint}</dd>}
    </div>
  );
}

function SummaryStats({ summary }: { summary: SupplierPurchasingSummary }) {
  const rate = onTimeRate(summary);
  const countOf = (status: PurchaseOrderStatus) => summary.ordersByStatus[status] ?? 0;
  const total = PURCHASE_ORDER_STATUSES.reduce((sum, status) => sum + countOf(status), 0);
  const byStatus = PURCHASE_ORDER_STATUSES.filter((status) => countOf(status) > 0);
  return (
    <div className="space-y-4 p-5 text-sm">
      <dl className="grid gap-4 sm:grid-cols-4">
        <Stat label="Orders" value={total} hint={`${summary.receivedOrders} fully received`} />
        <Stat
          label="Ordered value"
          value={
            summary.orderedValue.length === 0
              ? '—'
              : summary.orderedValue.map((v) => (
                  <span key={v.currency} className="block">
                    {formatMoney(v.total, v.currency)}
                  </span>
                ))
          }
          hint="Excluding cancelled orders"
        />
        <Stat
          label="On time"
          value={rate === null ? '—' : `${rate}%`}
          hint={
            rate === null
              ? 'No received order had an expected date'
              : `${summary.onTimeOrders} of ${summary.ordersWithExpectedDate} with an expected date`
          }
        />
        <Stat
          label="Average lead time"
          value={
            summary.averageLeadTimeDays === null
              ? '—'
              : `${summary.averageLeadTimeDays.toLocaleString('en', { maximumFractionDigits: 1 })} days`
          }
          hint="From approval to full receipt"
        />
      </dl>
      {byStatus.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Orders by status">
          {byStatus.map((status) => (
            <li key={status}>
              <Link
                href={`/purchase-orders?supplierId=${summary.supplierId}&status=${status}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-0.5 text-xs ring-1 ring-line ring-inset hover:text-accent"
              >
                {PURCHASE_ORDER_STATUS_LABELS[status].label}
                <span className="font-semibold tabular-nums">{countOf(status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentOrders({
  organizationId,
  supplierId,
}: {
  organizationId: string;
  supplierId: string;
}) {
  const orders = usePurchaseOrders(organizationId, {
    supplierId,
    pageSize: RECENT_ORDERS,
    sort: 'createdAt',
    direction: 'desc',
  });
  if (orders.isPending) return <LoadingRows label="Loading purchase orders" />;
  if (orders.isError) {
    return (
      <div className="p-4">
        <Alert tone="error">{describeError(orders.error)}</Alert>
      </div>
    );
  }
  if (orders.data.total === 0) return <EmptyState title="No purchase orders with this supplier" />;
  return (
    <ul className="divide-y divide-line border-t border-line">
      {orders.data.items.map((order) => (
        <li key={order.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-3">
            <Link
              href={`/purchase-orders/${order.id}`}
              className="font-mono text-xs font-medium hover:text-accent hover:underline"
            >
              {order.number}
            </Link>
            <span className="truncate text-xs text-ink-muted">
              {formatDate(order.createdAt)} · {order.warehouse.code}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span className="text-ink-muted tabular-nums">
              {formatMoney(order.total, order.currency)}
            </span>
            <PurchaseOrderStatusBadge status={order.status} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The supplier's purchasing record: volume, value, punctuality, and its latest orders. */
export function SupplierPurchasingPanel({
  organizationId,
  supplierId,
}: {
  organizationId: string;
  supplierId: string;
}) {
  const summary = useSupplierPurchasingSummary(organizationId, supplierId);
  return (
    <Panel
      title="Purchasing"
      description="Orders placed with this supplier and how they were delivered."
      actions={
        <Link href={`/purchase-orders?supplierId=${supplierId}`} className={LINK}>
          All orders
        </Link>
      }
    >
      {summary.isPending ? (
        <LoadingRows label="Loading purchasing summary" />
      ) : summary.isError ? (
        <div className="p-4">
          <Alert tone="error">{describeError(summary.error)}</Alert>
        </div>
      ) : (
        <SummaryStats summary={summary.data} />
      )}
      <RecentOrders organizationId={organizationId} supplierId={supplierId} />
    </Panel>
  );
}
