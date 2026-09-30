'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MAX_PURCHASE_ORDER_LINES, type PurchaseOrderDetail } from '@solmira/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { PICK_LIST_SIZE, useSuppliers, useWarehouses } from '@/lib/catalog-queries';
import { applyServerError } from '@/lib/forms';
import { formatMoney, fromMinorUnits } from '@/lib/money';
import { useCreatePurchaseOrder } from '@/lib/purchasing-queries';
import {
  emptyLine,
  linePreview,
  orderFieldFor,
  orderFormDefaults,
  orderFormSchema,
  orderPreview,
  toCreatePurchaseOrderRequest,
  type OrderFormInput,
  type OrderFormValues,
} from './form-values';
import { OrderTotalsSummary } from './order-totals';
import { VariantPicker } from './variant-picker';

type OrderForm = UseFormReturn<OrderFormInput, unknown, OrderFormValues>;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 sm:col-span-2">
        <span className="text-sm font-semibold">{title}</span>
        {description && <span className="block text-xs text-ink-muted">{description}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function LineRow({
  organizationId,
  form,
  index,
  currency,
  onRemove,
}: {
  organizationId: string;
  form: OrderForm;
  index: number;
  currency: string;
  onRemove: () => void;
}) {
  const line = useWatch({ control: form.control, name: `items.${index}` });
  const errors = form.formState.errors.items?.[index];
  const amounts = line ? linePreview(line, currency) : null;
  const set = (field: 'productId' | 'variantId' | 'unitCost', value: string) =>
    form.setValue(`items.${index}.${field}`, value, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });

  return (
    <li className="space-y-3 rounded-md border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Line {index + 1}</p>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove line ${index + 1}`}
          onClick={onRemove}
        >
          <Trash2 aria-hidden className="size-4" />
        </Button>
      </div>
      <VariantPicker
        organizationId={organizationId}
        currency={currency}
        productId={line?.productId ?? ''}
        variantId={line?.variantId ?? ''}
        productError={errors?.productId?.message}
        variantError={errors?.variantId?.message}
        onProductChange={(productId) => {
          set('productId', productId);
          set('variantId', '');
        }}
        onVariantChange={(variantId, cost) => {
          set('variantId', variantId);
          if (cost !== null) set('unitCost', fromMinorUnits(cost, currency));
        }}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField
          label="Quantity"
          inputMode="numeric"
          autoComplete="off"
          error={errors?.quantity?.message}
          {...form.register(`items.${index}.quantity`)}
        />
        <TextField
          label={`Unit cost (${currency || '—'})`}
          inputMode="decimal"
          autoComplete="off"
          error={errors?.unitCost?.message}
          {...form.register(`items.${index}.unitCost`)}
        />
        <TextField
          label="Tax %"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          error={errors?.taxPercent?.message}
          {...form.register(`items.${index}.taxPercent`)}
        />
        <div className="space-y-1.5 text-sm">
          <span className="block font-medium">Line total</span>
          <p className="py-2 tabular-nums" aria-live="polite">
            {amounts ? formatMoney(amounts.total, currency) : '—'}
          </p>
          {amounts && amounts.tax > 0 && (
            <p className="text-xs text-ink-muted">
              {formatMoney(amounts.subtotal, currency)} + {formatMoney(amounts.tax, currency)} tax
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

interface PurchaseOrderFormProps {
  organizationId: string;
  defaultCurrency: string;
  initialSupplierId?: string;
  onSaved: (order: PurchaseOrderDetail) => void;
  onCancel: () => void;
}

/** A new draft order with any number of lines; it can be saved without lines and filled later. */
export function PurchaseOrderForm({
  organizationId,
  defaultCurrency,
  initialSupplierId,
  onSaved,
  onCancel,
}: PurchaseOrderFormProps) {
  const { can } = usePermissions();
  const canListSuppliers = can('suppliers.read');
  const canListWarehouses = can('warehouses.read');
  const canPickProducts = can('products.read');
  const create = useCreatePurchaseOrder(organizationId);
  const suppliers = useSuppliers(
    organizationId,
    { status: 'ACTIVE', pageSize: PICK_LIST_SIZE, sort: 'companyName', direction: 'asc' },
    canListSuppliers,
  );
  const warehouses = useWarehouses(
    organizationId,
    { status: 'ACTIVE', pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    canListWarehouses,
  );

  const form = useForm<OrderFormInput, unknown, OrderFormValues>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      ...orderFormDefaults(defaultCurrency),
      supplierId: initialSupplierId ?? '',
      items: canPickProducts ? [emptyLine()] : [],
    },
  });
  const { errors, isSubmitting } = form.formState;
  const lines = useFieldArray({ control: form.control, name: 'items' });
  const items = useWatch({ control: form.control, name: 'items' });
  const currencyText = useWatch({ control: form.control, name: 'currency' });
  const shippingCost = useWatch({ control: form.control, name: 'shippingCost' });
  const currency = currencyText.trim().toUpperCase();
  const totals = orderPreview(items, shippingCost, currency);
  const itemsError = errors.items?.root?.message ?? errors.items?.message;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      onSaved(await create.mutateAsync(toCreatePurchaseOrderRequest(values)));
    } catch (error) {
      applyServerError(error, form.setError, orderFieldFor);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {(!canListSuppliers || !canListWarehouses) && (
        <Alert tone="warning" title="Some lists are unavailable">
          Choosing a supplier and a warehouse requires access to suppliers and warehouses. Ask an
          owner or admin for it.
        </Alert>
      )}
      <fieldset disabled={isSubmitting} className="space-y-8">
        <Section title="Supplier and destination">
          <SelectField
            label="Supplier"
            disabled={!canListSuppliers || suppliers.isPending}
            error={errors.supplierId?.message}
            hint={
              suppliers.isSuccess && suppliers.data.items.length === 0
                ? 'No active supplier yet'
                : undefined
            }
            {...form.register('supplierId')}
          >
            <option value="">Choose a supplier</option>
            {(suppliers.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.companyName}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Receiving warehouse"
            disabled={!canListWarehouses || warehouses.isPending}
            error={errors.warehouseId?.message}
            {...form.register('warehouseId')}
          >
            <option value="">Choose a warehouse</option>
            {(warehouses.data?.items ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </SelectField>
        </Section>

        <Section
          title="Pricing and shipping"
          description="Every amount on the order is in this currency; nothing is converted."
        >
          <TextField
            label="Currency"
            maxLength={3}
            autoComplete="off"
            hint="ISO code, e.g. USD"
            error={errors.currency?.message}
            {...form.register('currency')}
          />
          <TextField
            label="Shipping cost (optional)"
            inputMode="decimal"
            autoComplete="off"
            hint="Added once to the order total"
            error={errors.shippingCost?.message}
            {...form.register('shippingCost')}
          />
        </Section>

        <fieldset className="space-y-3">
          <legend className="mb-3">
            <span className="text-sm font-semibold">Items</span>
            <span className="block text-xs text-ink-muted">
              A draft can be saved without lines; it needs at least one to be submitted.
            </span>
          </legend>
          {!canPickProducts && (
            <Alert tone="warning" title="Product list unavailable">
              Adding lines requires access to products. Save the draft and ask someone who has it.
            </Alert>
          )}
          {itemsError && <Alert tone="error">{itemsError}</Alert>}
          {lines.fields.length > 0 && (
            <ul className="space-y-3">
              {lines.fields.map((field, index) => (
                <LineRow
                  key={field.id}
                  organizationId={organizationId}
                  form={form}
                  index={index}
                  currency={currency}
                  onRemove={() => lines.remove(index)}
                />
              ))}
            </ul>
          )}
          {canPickProducts && (
            <Button
              variant="secondary"
              size="sm"
              disabled={lines.fields.length >= MAX_PURCHASE_ORDER_LINES}
              onClick={() => lines.append(emptyLine())}
            >
              <Plus aria-hidden className="size-4" /> Add line
            </Button>
          )}
          <OrderTotalsSummary
            totals={totals}
            currency={currency}
            note={
              totals.incompleteLines > 0
                ? `${totals.incompleteLines} incomplete line${totals.incompleteLines === 1 ? '' : 's'} not counted yet. The server recalculates every amount on save.`
                : 'A preview; the server recalculates every amount on save.'
            }
          />
        </fieldset>

        <Section title="Delivery and notes">
          <TextField
            label="Expected delivery (optional)"
            type="date"
            error={errors.expectedDeliveryDate?.message}
            {...form.register('expectedDeliveryDate')}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="Notes (optional)"
              rows={3}
              hint="For the team and the supplier, e.g. delivery instructions"
              error={errors.notes?.message}
              {...form.register('notes')}
            />
          </div>
        </Section>
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Create draft
        </Button>
      </div>
    </form>
  );
}
