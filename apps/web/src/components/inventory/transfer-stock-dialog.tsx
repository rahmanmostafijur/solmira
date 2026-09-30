'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { InventoryLevel } from '@solmira/contracts';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { PICK_LIST_SIZE, useWarehouses } from '@/lib/catalog-queries';
import { applyServerError } from '@/lib/forms';
import { useTransferStock } from '@/lib/inventory-queries';
import {
  noteOrOmitted,
  parseUnits,
  transferFormSchema,
  type TransferFormInput,
  type TransferFormValues,
} from './form-values';
import { StockSummary } from './stock-summary';

const transferFieldFor = (path: string) =>
  path === 'quantity' || path === 'toWarehouseId' || path === 'note' ? path : '';

interface FormProps {
  organizationId: string;
  level: InventoryLevel;
  onDone: () => void;
}

function TransferStockForm({ organizationId, level, onDone }: FormProps) {
  const notify = useToast();
  const { can } = usePermissions();
  const canListWarehouses = can('warehouses.read');
  const warehouses = useWarehouses(
    organizationId,
    { status: 'ACTIVE', pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    canListWarehouses,
  );
  const transfer = useTransferStock(organizationId);
  const schema = useMemo(() => transferFormSchema(level.available), [level.available]);
  const form = useForm<TransferFormInput, unknown, TransferFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { toWarehouseId: '', quantity: '', note: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const destinations = (warehouses.data?.items ?? []).filter((w) => w.id !== level.warehouse.id);
  const nothingAvailable = level.available < 1;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await transfer.mutateAsync({
        fromWarehouseId: level.warehouse.id,
        toWarehouseId: values.toWarehouseId,
        variantId: level.item.variantId,
        quantity: parseUnits(values.quantity) ?? 0,
        ...noteOrOmitted(values.note),
      });
      notify(
        `Moved ${values.quantity} × ${level.item.sku} from ${result.from.warehouse.code} to ${result.to.warehouse.code}`,
      );
      onDone();
    } catch (error) {
      applyServerError(error, form.setError, transferFieldFor);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <StockSummary level={level} />
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {nothingAvailable && (
        <Alert tone="warning" title="Nothing available to move">
          All stock here is reserved or gone. Release a reservation or adjust stock first.
        </Alert>
      )}
      {!canListWarehouses && (
        <Alert tone="warning" title="Destination list unavailable">
          Choosing a destination requires access to warehouses. Ask an owner or admin for it.
        </Alert>
      )}
      <fieldset disabled={nothingAvailable || !canListWarehouses} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="To warehouse"
            disabled={warehouses.isPending}
            error={errors.toWarehouseId?.message}
            hint={
              warehouses.isSuccess && destinations.length === 0
                ? 'No other active warehouse to move stock to'
                : undefined
            }
            {...form.register('toWarehouseId')}
          >
            <option value="">Choose a warehouse</option>
            {destinations.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Quantity"
            inputMode="numeric"
            autoComplete="off"
            hint={`Up to ${level.available.toLocaleString('en')} available`}
            error={errors.quantity?.message}
            {...form.register('quantity')}
          />
        </div>
        <TextAreaField label="Note" error={errors.note?.message} {...form.register('note')} />
      </fieldset>
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={isSubmitting}
          disabled={nothingAvailable || !canListWarehouses}
        >
          Transfer stock
        </Button>
      </div>
    </form>
  );
}

export function TransferStockDialog({
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
      title="Transfer stock"
      description="Move available units to another warehouse. Both sides are recorded in the ledger."
      onClose={onClose}
    >
      {level && (
        <TransferStockForm organizationId={organizationId} level={level} onDone={onClose} />
      )}
    </Dialog>
  );
}
