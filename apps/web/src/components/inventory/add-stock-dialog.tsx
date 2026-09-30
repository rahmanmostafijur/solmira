'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { usePermissions } from '@/components/auth/can';
import { SearchInput } from '@/components/data-table/search-input';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { PICK_LIST_SIZE, useProducts, useVariants, useWarehouses } from '@/lib/catalog-queries';
import { applyServerError } from '@/lib/forms';
import { useAdjustStock } from '@/lib/inventory-queries';
import {
  addStockFieldFor,
  addStockFormSchema,
  toReceiptRequest,
  type AddStockFormInput,
  type AddStockFormValues,
} from './form-values';

/** Products offered per search; typing narrows the list rather than paging through it. */
const PRODUCT_CHOICES = 20;

interface FormProps {
  organizationId: string;
  initialWarehouseId?: string;
  onDone: () => void;
}

function AddStockForm({ organizationId, initialWarehouseId, onDone }: FormProps) {
  const notify = useToast();
  const { can } = usePermissions();
  const canListWarehouses = can('warehouses.read');
  const [search, setSearch] = useState('');
  const products = useProducts(organizationId, {
    search: search || undefined,
    pageSize: PRODUCT_CHOICES,
    sort: 'name',
    direction: 'asc',
  });
  const warehouses = useWarehouses(
    organizationId,
    { status: 'ACTIVE', pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    canListWarehouses,
  );
  const receive = useAdjustStock(organizationId);
  const form = useForm<AddStockFormInput, unknown, AddStockFormValues>({
    resolver: zodResolver(addStockFormSchema),
    defaultValues: {
      productId: '',
      variantId: '',
      warehouseId: initialWarehouseId ?? '',
      quantity: '',
      note: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const productId = useWatch({ control: form.control, name: 'productId' });
  const variants = useVariants(organizationId, productId, productId !== '');
  const variantChoices = (variants.data?.items ?? []).filter((v) => v.status !== 'ARCHIVED');
  const productChoices = (products.data?.items ?? []).filter((p) => p.status !== 'ARCHIVED');

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await receive.mutateAsync(toReceiptRequest(values));
      notify(`${saved.item.sku} in ${saved.warehouse.code}: ${saved.onHand} on hand`);
      onDone();
    } catch (error) {
      applyServerError(error, form.setError, addStockFieldFor);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      {!canListWarehouses && (
        <Alert tone="warning" title="Warehouse list unavailable">
          Choosing a warehouse requires access to warehouses. Ask an owner or admin for it.
        </Alert>
      )}
      <div className="space-y-2">
        <SearchInput label="Search products by name or SKU…" value={search} onChange={setSearch} />
        <SelectField
          label="Product"
          disabled={products.isPending}
          error={errors.productId?.message}
          hint={
            products.isSuccess && productChoices.length === 0 ? 'No product matches' : undefined
          }
          {...form.register('productId', {
            onChange: () => form.setValue('variantId', ''),
          })}
        >
          <option value="">Choose a product</option>
          {productChoices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.primarySku ? ` (${p.primarySku})` : ''}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Variant"
          disabled={productId === '' || variants.isPending}
          error={errors.variantId?.message}
          hint={
            variants.isSuccess && variantChoices.length === 0
              ? 'This product has no active variant'
              : undefined
          }
          {...form.register('variantId')}
        >
          <option value="">Choose a variant</option>
          {variantChoices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.sku} · {v.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Warehouse"
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
        <TextField
          label="Quantity received"
          inputMode="numeric"
          autoComplete="off"
          hint="Added to any stock already there"
          error={errors.quantity?.message}
          {...form.register('quantity')}
        />
      </div>
      <TextAreaField label="Note" error={errors.note?.message} {...form.register('note')} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={!canListWarehouses}>
          Add stock
        </Button>
      </div>
    </form>
  );
}

export function AddStockDialog({
  organizationId,
  open,
  initialWarehouseId,
  onClose,
}: {
  organizationId: string;
  open: boolean;
  initialWarehouseId?: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title="Add stock"
      description="Receive units of a variant into a warehouse, including one that holds none yet."
      size="lg"
      onClose={onClose}
    >
      {open && (
        <AddStockForm
          organizationId={organizationId}
          initialWarehouseId={initialWarehouseId}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}
