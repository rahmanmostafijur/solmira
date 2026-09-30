'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { PurchaseOrderDetail, PurchaseOrderItem } from '@solmira/contracts';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { applyServerError } from '@/lib/forms';
import { formatMoney, fromMinorUnits } from '@/lib/money';
import { useAddPurchaseOrderItem, useUpdatePurchaseOrderItem } from '@/lib/purchasing-queries';
import {
  emptyLine,
  lineFieldFor,
  lineFormDefaults,
  lineFormSchema,
  linePreview,
  toLineRequest,
  toUpdateLineRequest,
  type LineFormInput,
  type LineFormValues,
} from './form-values';
import { VariantPicker } from './variant-picker';

interface FormProps {
  organizationId: string;
  order: PurchaseOrderDetail;
  /** The line being edited; absent when adding one. */
  item: PurchaseOrderItem | null;
  onDone: () => void;
}

function LineForm({ organizationId, order, item, onDone }: FormProps) {
  const notify = useToast();
  const { currency } = order;
  const add = useAddPurchaseOrderItem(organizationId, order.id);
  const change = useUpdatePurchaseOrderItem(organizationId, order.id);
  const schema = useMemo(() => lineFormSchema(currency), [currency]);
  const form = useForm<LineFormInput, unknown, LineFormValues>({
    resolver: zodResolver(schema),
    defaultValues: item ? lineFormDefaults(item, currency) : emptyLine(),
  });
  const { errors, isSubmitting } = form.formState;
  const line = useWatch({ control: form.control });
  const amounts = linePreview({ ...emptyLine(), ...line }, currency);
  const taken = new Set(order.items.map((i) => i.variantId));

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (!item) {
        if (taken.has(values.variantId)) {
          form.setError('variantId', {
            message: 'Already on this order; edit that line’s quantity instead',
          });
          return;
        }
        await add.mutateAsync(toLineRequest(values, currency));
        notify('Line added');
      } else {
        const update = toUpdateLineRequest(values, item, currency);
        if (!update) {
          notify('Nothing to save', 'info');
          onDone();
          return;
        }
        await change.mutateAsync({ itemId: item.id, change: update });
        notify(`${item.sku} updated`);
      }
      onDone();
    } catch (error) {
      applyServerError(error, form.setError, lineFieldFor);
    }
  });

  const set = (field: 'productId' | 'variantId' | 'unitCost', value: string) =>
    form.setValue(field, value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {item ? (
        <div className="rounded-md border border-line bg-canvas px-4 py-3 text-sm">
          <p className="font-medium">
            <span className="font-mono text-xs">{item.sku}</span> · {item.productName}
            {item.variantName !== item.productName && ` · ${item.variantName}`}
          </p>
          <p className="text-xs text-ink-muted">To order another variant, add a new line.</p>
        </div>
      ) : (
        <VariantPicker
          organizationId={organizationId}
          currency={currency}
          productId={line.productId ?? ''}
          variantId={line.variantId ?? ''}
          productError={errors.productId?.message}
          variantError={errors.variantId?.message}
          onProductChange={(productId) => {
            set('productId', productId);
            set('variantId', '');
          }}
          onVariantChange={(variantId, cost) => {
            set('variantId', variantId);
            if (cost !== null) set('unitCost', fromMinorUnits(cost, currency));
          }}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label="Quantity"
          inputMode="numeric"
          autoComplete="off"
          error={errors.quantity?.message}
          {...form.register('quantity')}
        />
        <TextField
          label={`Unit cost (${currency})`}
          inputMode="decimal"
          autoComplete="off"
          error={errors.unitCost?.message}
          {...form.register('unitCost')}
        />
        <TextField
          label="Tax %"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          error={errors.taxPercent?.message}
          {...form.register('taxPercent')}
        />
      </div>
      <p className="text-sm" aria-live="polite">
        Line total:{' '}
        <span className="font-medium tabular-nums">
          {amounts ? formatMoney(amounts.total, currency) : '—'}
        </span>
        {amounts && amounts.tax > 0 && (
          <span className="text-ink-muted">
            {' '}
            ({formatMoney(amounts.subtotal, currency)} + {formatMoney(amounts.tax, currency)} tax)
          </span>
        )}
      </p>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {item ? 'Save line' : 'Add line'}
        </Button>
      </div>
    </form>
  );
}

export function LineDialog({
  organizationId,
  order,
  item,
  open,
  onClose,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  item: PurchaseOrderItem | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={item ? `Edit line ${item.sku}` : 'Add line'}
      description={`Amounts in ${order.currency}. The server recalculates totals when it saves.`}
      size="lg"
      onClose={onClose}
    >
      {open && (
        <LineForm organizationId={organizationId} order={order} item={item} onDone={onClose} />
      )}
    </Dialog>
  );
}
