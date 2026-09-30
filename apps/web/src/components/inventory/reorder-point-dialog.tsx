'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { InventoryLevel } from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { applyServerError } from '@/lib/forms';
import { useUpdateReorderPoint } from '@/lib/inventory-queries';
import {
  reorderFormSchema,
  toReorderPoint,
  type ReorderFormInput,
  type ReorderFormValues,
} from './form-values';
import { StockSummary } from './stock-summary';

interface FormProps {
  organizationId: string;
  level: InventoryLevel;
  onDone: () => void;
}

function ReorderPointForm({ organizationId, level, onDone }: FormProps) {
  const notify = useToast();
  const update = useUpdateReorderPoint(organizationId);
  const form = useForm<ReorderFormInput, unknown, ReorderFormValues>({
    resolver: zodResolver(reorderFormSchema),
    defaultValues: { reorderPoint: level.reorderPoint?.toString() ?? '' },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync({
        id: level.id,
        change: { reorderPoint: toReorderPoint(values) },
      });
      notify(
        saved.reorderPoint === null
          ? `Low-stock alert off for ${saved.item.sku}`
          : `${saved.item.sku} is low at ${saved.reorderPoint} available or fewer`,
      );
      onDone();
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <StockSummary level={level} />
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <TextField
        label="Reorder point"
        inputMode="numeric"
        autoComplete="off"
        hint="Marked low stock when available falls to this or below. Leave empty to switch off."
        error={errors.reorderPoint?.message}
        {...form.register('reorderPoint')}
      />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Save reorder point
        </Button>
      </div>
    </form>
  );
}

export function ReorderPointDialog({
  organizationId,
  level,
  onClose,
}: {
  organizationId: string;
  level: InventoryLevel | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={level !== null} title="Set reorder point" onClose={onClose}>
      {level && <ReorderPointForm organizationId={organizationId} level={level} onDone={onClose} />}
    </Dialog>
  );
}
