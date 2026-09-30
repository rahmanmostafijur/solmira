'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { InventoryLevel } from '@solmira/contracts';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { applyServerError } from '@/lib/forms';
import { useReserveStock } from '@/lib/inventory-queries';
import {
  noteOrOmitted,
  parseUnits,
  reserveFieldFor,
  reserveFormSchema,
  type ReserveFormInput,
  type ReserveFormValues,
} from './form-values';
import { StockSummary } from './stock-summary';

interface FormProps {
  organizationId: string;
  level: InventoryLevel;
  onDone: () => void;
}

function ReserveStockForm({ organizationId, level, onDone }: FormProps) {
  const notify = useToast();
  const reserve = useReserveStock(organizationId);
  const schema = useMemo(() => reserveFormSchema(level.available), [level.available]);
  const form = useForm<ReserveFormInput, unknown, ReserveFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: '', reference: '', note: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const nothingAvailable = level.available < 1;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await reserve.mutateAsync({
        lines: [
          {
            warehouseId: level.warehouse.id,
            variantId: level.item.variantId,
            quantity: parseUnits(values.quantity) ?? 0,
          },
        ],
        reference: values.reference,
        ...noteOrOmitted(values.note),
      });
      notify(`Reserved ${values.quantity} × ${level.item.sku} for ${values.reference}`);
      onDone();
    } catch (error) {
      applyServerError(error, form.setError, reserveFieldFor);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <StockSummary level={level} />
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {nothingAvailable && (
        <Alert tone="warning" title="Nothing available to reserve">
          Every unit here is already reserved or the shelf is empty.
        </Alert>
      )}
      <fieldset disabled={nothingAvailable} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Quantity"
            inputMode="numeric"
            autoComplete="off"
            hint={`Up to ${level.available.toLocaleString('en')} available`}
            error={errors.quantity?.message}
            {...form.register('quantity')}
          />
          <TextField
            label="Reference"
            autoComplete="off"
            maxLength={100}
            hint="What the stock is held for, e.g. Trade show samples"
            error={errors.reference?.message}
            {...form.register('reference')}
          />
        </div>
        <TextAreaField label="Note" error={errors.note?.message} {...form.register('note')} />
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={nothingAvailable}>
          Reserve stock
        </Button>
      </div>
    </form>
  );
}

export function ReserveStockDialog({
  organizationId,
  level,
  onClose,
}: {
  organizationId: string;
  level: InventoryLevel | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={level !== null}
      title="Reserve stock"
      description="Hold units so they cannot be promised elsewhere. Release the reservation to free them."
      onClose={onClose}
    >
      {level && <ReserveStockForm organizationId={organizationId} level={level} onDone={onClose} />}
    </Dialog>
  );
}
