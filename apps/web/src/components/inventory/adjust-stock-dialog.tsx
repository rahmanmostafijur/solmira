'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ADJUSTMENT_DIRECTIONS, ADJUSTMENT_REASONS, type InventoryLevel } from '@solmira/contracts';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { applyServerError } from '@/lib/forms';
import { useAdjustStock } from '@/lib/inventory-queries';
import {
  DIRECTION_HINTS,
  adjustFieldFor,
  adjustFormSchema,
  onHandAfter,
  toAdjustRequest,
  type AdjustFormInput,
  type AdjustFormValues,
} from './form-values';
import { ADJUSTMENT_REASON_LABELS } from './labels';
import { StockSummary } from './stock-summary';

interface FormProps {
  organizationId: string;
  level: InventoryLevel;
  onDone: () => void;
}

function AdjustStockForm({ organizationId, level, onDone }: FormProps) {
  const notify = useToast();
  const adjust = useAdjustStock(organizationId);
  const form = useForm<AdjustFormInput, unknown, AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    defaultValues: { reason: 'CORRECTION', quantity: '', note: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const reason = useWatch({ control: form.control, name: 'reason' });
  const quantity = useWatch({ control: form.control, name: 'quantity' });
  const counting = reason === 'COUNT';
  const after = onHandAfter(reason, quantity, level.onHand);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await adjust.mutateAsync(
        toAdjustRequest(values, {
          warehouseId: level.warehouse.id,
          variantId: level.item.variantId,
        }),
      );
      notify(`${saved.item.sku} in ${saved.warehouse.code}: ${saved.onHand} on hand`);
      onDone();
    } catch (error) {
      applyServerError(error, form.setError, adjustFieldFor);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <StockSummary level={level} />
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Reason" error={errors.reason?.message} {...form.register('reason')}>
          {ADJUSTMENT_REASONS.map((value) => (
            <option key={value} value={value}>
              {ADJUSTMENT_REASON_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <TextField
          label={counting ? 'Counted quantity' : 'Change'}
          inputMode={counting ? 'numeric' : 'text'}
          autoComplete="off"
          hint={
            counting
              ? 'Units physically on the shelf; the difference is recorded'
              : DIRECTION_HINTS[ADJUSTMENT_DIRECTIONS[reason]]
          }
          error={errors.quantity?.message}
          {...form.register('quantity')}
        />
        <div className="sm:col-span-2">
          <TextAreaField label="Note" error={errors.note?.message} {...form.register('note')} />
        </div>
      </div>
      {after !== null && (
        <p className="text-sm text-ink-muted" aria-live="polite">
          On hand after this adjustment:{' '}
          <span className={after < 0 ? 'font-medium text-danger' : 'font-medium text-ink'}>
            {after.toLocaleString('en')}
          </span>
          {after < level.reserved &&
            `, less than the ${level.reserved.toLocaleString('en')} already reserved`}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Record adjustment
        </Button>
      </div>
    </form>
  );
}

export function AdjustStockDialog({
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
      title="Adjust stock"
      description="Record a count, receipt, loss or correction. Every change is kept in the ledger."
      onClose={onClose}
    >
      {level && <AdjustStockForm organizationId={organizationId} level={level} onDone={onClose} />}
    </Dialog>
  );
}
