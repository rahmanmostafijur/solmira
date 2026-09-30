'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  isPurchaseOrderEditable,
  isPurchaseOrderOpen,
  type PurchaseOrderDetail,
} from '@solmira/contracts';
import { Lock } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { PICK_LIST_SIZE, useSuppliers, useWarehouses } from '@/lib/catalog-queries';
import { formatMoney } from '@/lib/money';
import { useUpdatePurchaseOrder } from '@/lib/purchasing-queries';
import {
  headerFieldFor,
  headerFormDefaults,
  headerFormSchema,
  toUpdatePurchaseOrderRequest,
  type HeaderFormInput,
  type HeaderFormValues,
} from './form-values';
import { applyPurchasingError } from './server-errors';

/** A field fixed once the order was submitted: shown, with the reason it can't change. */
function LockedValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <Lock aria-hidden className="size-3.5 text-ink-muted" />
        {label}
      </span>
      <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink-muted">
        {value}
      </p>
      <p className="text-xs text-ink-muted">Locked after submission</p>
    </div>
  );
}

interface OrderHeaderFormProps {
  organizationId: string;
  order: PurchaseOrderDetail;
}

/**
 * The order's own fields. A draft can change all of them; once submitted only the expected
 * delivery date and notes stay editable while the order is open; a closed order is read-only.
 */
export function OrderHeaderForm({ organizationId, order }: OrderHeaderFormProps) {
  const notify = useToast();
  const { can } = usePermissions();
  const canUpdate = can('purchase_orders.update');
  const draft = isPurchaseOrderEditable(order.status) && canUpdate;
  const open = isPurchaseOrderOpen(order.status) && canUpdate;
  const update = useUpdatePurchaseOrder(organizationId, order.id);
  const suppliers = useSuppliers(
    organizationId,
    { status: 'ACTIVE', pageSize: PICK_LIST_SIZE, sort: 'companyName', direction: 'asc' },
    draft && can('suppliers.read'),
  );
  const warehouses = useWarehouses(
    organizationId,
    { status: 'ACTIVE', pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    draft && can('warehouses.read'),
  );
  const form = useForm<HeaderFormInput, unknown, HeaderFormValues>({
    resolver: zodResolver(headerFormSchema),
    defaultValues: headerFormDefaults(order),
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  // The current supplier and warehouse stay selectable even after they were deactivated.
  const supplierChoices = [
    { id: order.supplier.id, label: order.supplier.companyName },
    ...(suppliers.data?.items ?? [])
      .filter((s) => s.id !== order.supplier.id)
      .map((s) => ({ id: s.id, label: s.companyName })),
  ];
  const warehouseChoices = [
    { id: order.warehouse.id, label: `${order.warehouse.code} · ${order.warehouse.name}` },
    ...(warehouses.data?.items ?? [])
      .filter((w) => w.id !== order.warehouse.id)
      .map((w) => ({ id: w.id, label: `${w.code} · ${w.name}` })),
  ];

  const onSubmit = form.handleSubmit(async (values) => {
    const change = toUpdatePurchaseOrderRequest(values, order);
    if (!change) {
      notify('Nothing to save', 'info');
      return;
    }
    try {
      const saved = await update.mutateAsync(change);
      form.reset(headerFormDefaults(saved));
      notify('Order saved');
    } catch (error) {
      applyPurchasingError(error, form.setError, headerFieldFor);
    }
  });

  const submitted = order.status !== 'DRAFT' && isPurchaseOrderOpen(order.status);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <fieldset disabled={!open || isSubmitting} className="grid gap-4 sm:grid-cols-2">
        {draft ? (
          <>
            <SelectField
              label="Supplier"
              error={errors.supplierId?.message}
              {...form.register('supplierId')}
            >
              {supplierChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="Receiving warehouse"
              error={errors.warehouseId?.message}
              {...form.register('warehouseId')}
            >
              {warehouseChoices.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Currency"
              maxLength={3}
              autoComplete="off"
              hint={
                order.items.length > 0
                  ? 'Line costs are not converted: check them after changing the currency'
                  : 'ISO code, e.g. USD'
              }
              error={errors.currency?.message}
              {...form.register('currency')}
            />
            <TextField
              label="Shipping cost"
              inputMode="decimal"
              autoComplete="off"
              hint="Leave empty for none"
              error={errors.shippingCost?.message}
              {...form.register('shippingCost')}
            />
          </>
        ) : submitted ? (
          <>
            <LockedValue label="Supplier" value={order.supplier.companyName} />
            <LockedValue
              label="Receiving warehouse"
              value={`${order.warehouse.code} · ${order.warehouse.name}`}
            />
            <LockedValue label="Currency" value={order.currency} />
            <LockedValue
              label="Shipping cost"
              value={formatMoney(order.shippingCost, order.currency)}
            />
          </>
        ) : null}
        <TextField
          label="Expected delivery"
          type="date"
          hint={submitted && open ? 'Still editable while the order is open' : undefined}
          error={errors.expectedDeliveryDate?.message}
          {...form.register('expectedDeliveryDate')}
        />
        <div className="sm:col-span-2">
          <TextAreaField
            label="Notes"
            rows={3}
            error={errors.notes?.message}
            {...form.register('notes')}
          />
        </div>
      </fieldset>
      {open && (
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button
            variant="secondary"
            onClick={() => form.reset(headerFormDefaults(order))}
            disabled={!isDirty || isSubmitting}
          >
            Discard
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}
