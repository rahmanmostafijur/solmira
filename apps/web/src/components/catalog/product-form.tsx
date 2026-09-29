'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { TAX_CATEGORIES, type ProductDetail } from '@solmira/contracts';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  PICK_LIST_SIZE,
  useCategories,
  useCreateProduct,
  useSuppliers,
  useUpdateProduct,
} from '@/lib/catalog-queries';
import { applyServerError } from '@/lib/forms';
import { categoryOptions } from './category-tree';
import {
  productFormDefaults,
  productFormSchema,
  toCreateProductRequest,
  toUpdateProductRequest,
  type ProductFormInput,
  type ProductFormValues,
} from './form-values';
import { TAX_CATEGORY_LABELS } from './labels';

interface ProductFormProps {
  organizationId: string;
  /** Absent when creating. */
  product?: ProductDetail;
  defaultCurrency?: string;
  readOnly?: boolean;
  onSaved: (product: ProductDetail) => void;
  onCancel?: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold sm:col-span-2">{title}</legend>
      {children}
    </fieldset>
  );
}

/** One form for create and edit. Edits send only the changed fields. */
export function ProductForm({
  organizationId,
  product,
  defaultCurrency,
  readOnly,
  onSaved,
  onCancel,
}: ProductFormProps) {
  const notify = useToast();
  const creating = !product;
  const create = useCreateProduct(organizationId);
  const update = useUpdateProduct(organizationId, product?.id ?? '');
  const categories = useCategories(organizationId);
  const suppliers = useSuppliers(organizationId, {
    status: 'ACTIVE',
    pageSize: PICK_LIST_SIZE,
    sort: 'companyName',
    direction: 'asc',
  });

  const form = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: productFormDefaults(product, defaultCurrency),
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  const categoryChoices = useMemo(() => {
    const all = categories.data?.items ?? [];
    return categoryOptions(all).filter(
      (option) =>
        all.find((c) => c.id === option.id)?.status === 'ACTIVE' ||
        option.id === product?.category?.id,
    );
  }, [categories.data, product?.category?.id]);

  // The current supplier stays selectable even after it was deactivated.
  const supplierChoices = useMemo(() => {
    const active = (suppliers.data?.items ?? []).map((s) => ({ id: s.id, label: s.companyName }));
    const current = product?.supplier;
    return current && !active.some((s) => s.id === current.id)
      ? [...active, { id: current.id, label: `${current.companyName} (inactive)` }]
      : active;
  }, [suppliers.data, product?.supplier]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (creating) {
        onSaved(await create.mutateAsync(toCreateProductRequest(values)));
        return;
      }
      const change = toUpdateProductRequest(values, product);
      if (!change) {
        notify('Nothing to save', 'info');
        return;
      }
      const saved = await update.mutateAsync(change);
      form.reset(productFormDefaults(saved));
      onSaved(saved);
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <fieldset disabled={readOnly} className="space-y-8">
        <Section title="Basics">
          <TextField
            label="Name"
            autoComplete="off"
            error={errors.name?.message}
            {...form.register('name')}
          />
          <TextField
            label="Brand"
            autoComplete="off"
            error={errors.brand?.message}
            {...form.register('brand')}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="Description"
              rows={4}
              error={errors.description?.message}
              {...form.register('description')}
            />
          </div>
        </Section>

        <Section title="Classification">
          <SelectField
            label="Category"
            error={errors.categoryId?.message}
            {...form.register('categoryId')}
          >
            <option value="">No category</option>
            {categoryChoices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Supplier"
            error={errors.supplierId?.message}
            {...form.register('supplierId')}
          >
            <option value="">No supplier</option>
            {supplierChoices.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </Section>

        <Section title="Pricing">
          <TextField
            label="Currency"
            maxLength={3}
            autoComplete="off"
            hint="ISO code, e.g. USD"
            error={errors.currency?.message}
            {...form.register('currency')}
          />
          <SelectField
            label="Tax category"
            error={errors.taxCategory?.message}
            {...form.register('taxCategory')}
          >
            {TAX_CATEGORIES.map((tax) => (
              <option key={tax} value={tax}>
                {TAX_CATEGORY_LABELS[tax]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Base price"
            inputMode="decimal"
            autoComplete="off"
            hint="Variants without their own price use this"
            error={errors.basePrice?.message}
            {...form.register('basePrice')}
          />
          <TextField
            label="Base cost (optional)"
            inputMode="decimal"
            autoComplete="off"
            error={errors.baseCost?.message}
            {...form.register('baseCost')}
          />
        </Section>

        <Section title="Shipping (optional)">
          <TextField
            label="Weight (g)"
            inputMode="numeric"
            error={errors.weightGrams?.message}
            {...form.register('weightGrams')}
          />
          <TextField
            label="Length (mm)"
            inputMode="numeric"
            error={errors.lengthMm?.message}
            {...form.register('lengthMm')}
          />
          <TextField
            label="Width (mm)"
            inputMode="numeric"
            error={errors.widthMm?.message}
            {...form.register('widthMm')}
          />
          <TextField
            label="Height (mm)"
            inputMode="numeric"
            error={errors.heightMm?.message}
            {...form.register('heightMm')}
          />
        </Section>

        {creating && (
          <Section title="First variant (optional)">
            <TextField
              label="SKU"
              autoComplete="off"
              hint="Unique in your organization. Letters, numbers, . _ / -"
              error={errors.initialVariant?.sku?.message}
              {...form.register('initialVariant.sku')}
            />
            <TextField
              label="Variant name"
              autoComplete="off"
              hint="Defaults to “Default”"
              error={errors.initialVariant?.name?.message}
              {...form.register('initialVariant.name')}
            />
          </Section>
        )}
      </fieldset>

      {!readOnly && (
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={isSubmitting} disabled={!creating && !isDirty}>
            {creating ? 'Create product' : 'Save changes'}
          </Button>
        </div>
      )}
    </form>
  );
}
