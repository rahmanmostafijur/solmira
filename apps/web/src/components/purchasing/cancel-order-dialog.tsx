'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  cancelPurchaseOrderRequestSchema,
  type CancelPurchaseOrderRequest,
  type PurchaseOrderDetail,
} from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { TextAreaField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { applyServerError } from '@/lib/forms';
import { useCancelPurchaseOrder } from '@/lib/purchasing-queries';
import { formatUnits } from './labels';

function CancelForm({
  organizationId,
  order,
  onDone,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  onDone: () => void;
}) {
  const notify = useToast();
  const cancel = useCancelPurchaseOrder(organizationId);
  const form = useForm<CancelPurchaseOrderRequest>({
    resolver: zodResolver(cancelPurchaseOrderRequestSchema),
    defaultValues: { reason: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const { receivedUnits, remainingUnits } = order.receiving;
  const partlyReceived = order.status === 'PARTIALLY_RECEIVED';

  const onSubmit = form.handleSubmit(async (body) => {
    try {
      await cancel.mutateAsync({ id: order.id, body });
      notify(`${order.number} cancelled`);
      onDone();
    } catch (error) {
      applyServerError(error, form.setError, (path) => (path === 'reason' ? path : ''));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {partlyReceived ? (
        <Alert tone="warning" title="Part of this order has already arrived">
          The {formatUnits(receivedUnits)} units received stay in stock. Cancelling closes the{' '}
          {formatUnits(remainingUnits)} units still outstanding; they can no longer be received.
        </Alert>
      ) : (
        <p className="text-sm text-ink-muted">
          A cancelled order is closed for good: it cannot be edited, approved or received.
        </p>
      )}
      <TextAreaField
        label="Reason"
        rows={3}
        hint="Kept on the order for everyone to see"
        error={errors.reason?.message}
        {...form.register('reason')}
      />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Keep order
        </Button>
        <Button type="submit" variant="danger" loading={isSubmitting}>
          {partlyReceived ? 'Cancel remainder' : 'Cancel order'}
        </Button>
      </div>
    </form>
  );
}

export function CancelOrderDialog({
  organizationId,
  order,
  open,
  onClose,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={`Cancel ${order.number}`} onClose={onClose}>
      {open && <CancelForm organizationId={organizationId} order={order} onDone={onClose} />}
    </Dialog>
  );
}
