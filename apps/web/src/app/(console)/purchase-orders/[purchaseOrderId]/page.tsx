'use client';

import {
  canApproveOwnOrder,
  isPurchaseOrderReceivable,
  type FieldIssue,
  type PurchaseOrderDetail,
} from '@solmira/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { formatDateTime } from '@/components/catalog/labels';
import { ApprovalPanel } from '@/components/purchasing/approval-panel';
import {
  describeIssuePath,
  formatDeliveryDate,
  isDeliveryOverdue,
  localToday,
} from '@/components/purchasing/labels';
import { OrderActions } from '@/components/purchasing/order-actions';
import { OrderHeaderForm } from '@/components/purchasing/order-header-form';
import { OrderLines } from '@/components/purchasing/order-lines';
import { ReceiptHistory } from '@/components/purchasing/receipt-history';
import { ReceivingProgress } from '@/components/purchasing/receiving-progress';
import { PurchaseOrderStatusBadge } from '@/components/purchasing/status-badge';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { ApiError, describeError } from '@/lib/api/client';
import { formatMoney } from '@/lib/money';
import { usePurchaseOrder } from '@/lib/purchasing-queries';

const LINK = 'font-medium text-ink hover:text-accent hover:underline';

function OrderSummary({ order }: { order: PurchaseOrderDetail }) {
  const { can } = usePermissions();
  const overdue = isDeliveryOverdue(order.expectedDeliveryDate, order.status, localToday());
  const facts: [string, ReactNode][] = [
    [
      'Supplier',
      can('suppliers.read') ? (
        <Link href={`/suppliers/${order.supplier.id}`} className={LINK}>
          {order.supplier.companyName}
        </Link>
      ) : (
        order.supplier.companyName
      ),
    ],
    [
      'Receiving warehouse',
      can('warehouses.read') ? (
        <Link href={`/warehouses/${order.warehouse.id}`} className={LINK}>
          {order.warehouse.code} · {order.warehouse.name}
        </Link>
      ) : (
        `${order.warehouse.code} · ${order.warehouse.name}`
      ),
    ],
    [
      'Total',
      <span key="t" className="font-semibold tabular-nums">
        {formatMoney(order.total, order.currency)}
      </span>,
    ],
    [
      'Expected delivery',
      order.expectedDeliveryDate ? (
        <span className={overdue ? 'text-danger' : undefined}>
          {formatDeliveryDate(order.expectedDeliveryDate)}
          {overdue && ' · overdue'}
        </span>
      ) : (
        <span className="text-ink-muted">Not set</span>
      ),
    ],
    ['Created', formatDateTime(order.createdAt)],
    ['Last changed', formatDateTime(order.updatedAt)],
  ];
  return (
    <Panel>
      <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
      {order.status !== 'DRAFT' && order.items.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <ReceivingProgress receiving={order.receiving} />
        </div>
      )}
    </Panel>
  );
}

function PurchaseOrderView({
  organizationId,
  purchaseOrderId,
}: {
  organizationId: string;
  purchaseOrderId: string;
}) {
  const { session } = useAuth();
  const { can } = usePermissions();
  const query = usePurchaseOrder(organizationId, purchaseOrderId);
  const [issues, setIssues] = useState<readonly FieldIssue[] | null>(null);

  if (query.isPending) return <LoadingRows rows={6} label="Loading purchase order" />;
  if (query.isError) {
    return query.error instanceof ApiError &&
      (query.error.status === 404 || query.error.status === 400) ? (
      <EmptyState
        title="Purchase order not found"
        action={
          <Link href="/purchase-orders" className="text-sm font-medium text-accent hover:underline">
            Back to purchase orders
          </Link>
        }
      />
    ) : (
      <Alert tone="error">{describeError(query.error)}</Alert>
    );
  }
  const order = query.data;
  const userId = session?.user.id ?? '';
  const ownOrder = !canApproveOwnOrder(userId, order);
  const editableLines = order.status === 'DRAFT' && can('purchase_orders.update');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="mb-2 text-sm">
          <Link href="/purchase-orders" className="text-ink-muted hover:text-ink">
            ← Purchase orders
          </Link>
        </p>
        <PageHeader
          title={order.number}
          description={`${order.supplier.companyName} → ${order.warehouse.code} · ${order.warehouse.name}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PurchaseOrderStatusBadge status={order.status} />
              <OrderActions
                organizationId={organizationId}
                order={order}
                ownOrder={ownOrder}
                onSubmitRefused={setIssues}
              />
            </div>
          }
        />
      </div>
      {issues && order.status === 'DRAFT' && (
        <Alert tone="error" title="This order cannot be submitted yet">
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <span className="font-medium">{describeIssuePath(issue.path, order.items)}:</span>{' '}
                {issue.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <OrderSummary order={order} />
      <ApprovalPanel organizationId={organizationId} order={order} ownOrder={ownOrder} />
      <OrderLines organizationId={organizationId} order={order} editable={editableLines} />
      <Panel
        title="Order details"
        description={
          order.status === 'DRAFT'
            ? 'Everything can change until the order is submitted.'
            : 'Only the expected delivery date and notes can change after submission.'
        }
      >
        <div className="p-5">
          <OrderHeaderForm key={order.updatedAt} organizationId={organizationId} order={order} />
        </div>
      </Panel>
      {(isPurchaseOrderReceivable(order.status) || order.receiving.receiptCount > 0) && (
        <Panel title="Receipts" description="Deliveries recorded against this order, newest first.">
          <ReceiptHistory organizationId={organizationId} purchaseOrderId={order.id} />
        </Panel>
      )}
    </div>
  );
}

export default function PurchaseOrderPage() {
  const { purchaseOrderId } = useParams<{ purchaseOrderId: string }>();
  return (
    <RequireOrganization permission="purchase_orders.read">
      {(organization) => (
        <PurchaseOrderView organizationId={organization.id} purchaseOrderId={purchaseOrderId} />
      )}
    </RequireOrganization>
  );
}
