'use client';

import {
  isPurchaseOrderOpen,
  isPurchaseOrderReceivable,
  type FieldIssue,
  type PurchaseOrderDetail,
} from '@solmira/contracts';
import { PackageCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError, describeError } from '@/lib/api/client';
import { useApprovePurchaseOrder, useSubmitPurchaseOrder } from '@/lib/purchasing-queries';
import { CancelOrderDialog } from './cancel-order-dialog';

type Pending = 'submit' | 'approve' | 'cancel' | null;

const OWN_ORDER_HINT = 'You created or submitted this order, so someone else has to approve it.';

const CONFIRM = {
  submit: (number: string) => ({
    title: `Submit ${number} for approval?`,
    description:
      'Supplier, warehouse, currency, shipping and lines are locked once submitted. Notes and the expected delivery date stay editable.',
    confirmLabel: 'Submit',
  }),
  approve: (number: string) => ({
    title: `Approve ${number}?`,
    description: 'Once approved, stock can be received against this order into its warehouse.',
    confirmLabel: 'Approve',
  }),
};

/**
 * The lifecycle actions the order's status allows and the viewer's role grants. Hiding a button
 * is a courtesy; the API enforces every rule, including separation of duties on approval.
 */
export function OrderActions({
  organizationId,
  order,
  ownOrder,
  onSubmitRefused,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  ownOrder: boolean;
  /** Field issues from a refused submission (e.g. an inactive variant), or null to clear them. */
  onSubmitRefused: (issues: readonly FieldIssue[] | null) => void;
}) {
  const notify = useToast();
  const { can } = usePermissions();
  const submit = useSubmitPurchaseOrder(organizationId);
  const approve = useApprovePurchaseOrder(organizationId);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);

  const run = async (action: 'submit' | 'approve') => {
    const mutation = action === 'submit' ? submit : approve;
    try {
      const saved = await mutation.mutateAsync(order.id);
      onSubmitRefused(null);
      notify(
        action === 'submit' ? `${saved.number} submitted for approval` : `${saved.number} approved`,
      );
    } catch (error) {
      if (
        action === 'submit' &&
        error instanceof ApiError &&
        error.code === 'VALIDATION_FAILED' &&
        error.details.length > 0
      ) {
        onSubmitRefused(error.details);
      } else {
        notify(describeError(error), 'error');
      }
    } finally {
      close();
    }
  };

  const canSubmit = order.status === 'DRAFT' && can('purchase_orders.submit');
  const canApprove = order.status === 'SUBMITTED' && can('purchase_orders.approve');
  const canCancel = isPurchaseOrderOpen(order.status) && can('purchase_orders.cancel');
  const canReceive = isPurchaseOrderReceivable(order.status) && can('purchase_orders.receive');

  return (
    <>
      {canCancel && (
        <Button variant="secondary" onClick={() => setPending('cancel')}>
          {order.status === 'PARTIALLY_RECEIVED' ? 'Cancel remainder' : 'Cancel order'}
        </Button>
      )}
      {canSubmit && (
        <Button
          onClick={() => setPending('submit')}
          disabled={order.items.length === 0}
          title={order.items.length === 0 ? 'Add at least one line first' : undefined}
        >
          Submit for approval
        </Button>
      )}
      {canApprove && (
        <Button
          onClick={() => setPending('approve')}
          disabled={ownOrder}
          title={ownOrder ? OWN_ORDER_HINT : undefined}
        >
          Approve
        </Button>
      )}
      {canReceive && (
        <Link
          href={`/purchase-orders/${order.id}/receive`}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/90"
        >
          <PackageCheck aria-hidden className="size-4" /> Receive stock
        </Link>
      )}
      <ConfirmDialog
        open={pending === 'submit' || pending === 'approve'}
        {...(pending === 'approve' ? CONFIRM.approve(order.number) : CONFIRM.submit(order.number))}
        tone="primary"
        pending={submit.isPending || approve.isPending}
        onConfirm={() => void run(pending === 'approve' ? 'approve' : 'submit')}
        onCancel={close}
      />
      <CancelOrderDialog
        organizationId={organizationId}
        order={order}
        open={pending === 'cancel'}
        onClose={close}
      />
    </>
  );
}
