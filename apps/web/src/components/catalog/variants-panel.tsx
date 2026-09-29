'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ProductDetail, Variant, VariantStatus } from '@solmira/contracts';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useCreateVariant, useUpdateVariant, useVariants } from '@/lib/catalog-queries';
import { applyServerError } from '@/lib/forms';
import { formatMoney } from '@/lib/money';
import {
  toCreateVariantRequest,
  toUpdateVariantRequest,
  variantFormDefaults,
  variantFormSchema,
  type VariantFormInput,
  type VariantFormValues,
} from './form-values';
import { VARIANT_STATUS_LABELS, variantStatusActions } from './labels';

interface VariantFormProps {
  organizationId: string;
  product: ProductDetail;
  variant?: Variant;
  onDone: () => void;
}

function VariantForm({ organizationId, product, variant, onDone }: VariantFormProps) {
  const notify = useToast();
  const create = useCreateVariant(organizationId, product.id);
  const update = useUpdateVariant(organizationId, product.id);
  const form = useForm<VariantFormInput, unknown, VariantFormValues>({
    resolver: zodResolver(variantFormSchema(product.currency)),
    defaultValues: variantFormDefaults(product.currency, variant),
  });
  const attributes = useFieldArray({ control: form.control, name: 'attributes' });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (!variant) {
        await create.mutateAsync(toCreateVariantRequest(values, product.currency));
        notify(`Variant ${values.sku.toUpperCase()} added`);
      } else {
        const change = toUpdateVariantRequest(values, variant, product.currency);
        if (change) await update.mutateAsync({ id: variant.id, change });
        notify(change ? 'Variant saved' : 'Nothing to save', change ? 'success' : 'info');
      }
      onDone();
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="SKU"
          autoComplete="off"
          error={errors.sku?.message}
          {...form.register('sku')}
        />
        <TextField
          label="Name"
          autoComplete="off"
          hint="e.g. Size 42 / Black"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label="Barcode (EAN/UPC)"
          inputMode="numeric"
          autoComplete="off"
          error={errors.barcode?.message}
          {...form.register('barcode')}
        />
        <TextField
          label="Weight (g)"
          inputMode="numeric"
          error={errors.weightGrams?.message}
          {...form.register('weightGrams')}
        />
        <TextField
          label={`Price (${product.currency})`}
          inputMode="decimal"
          hint={`Empty uses the base price, ${formatMoney(product.basePrice, product.currency)}`}
          error={errors.price?.message}
          {...form.register('price')}
        />
        <TextField
          label={`Cost (${product.currency})`}
          inputMode="decimal"
          error={errors.cost?.message}
          {...form.register('cost')}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Attributes</legend>
        {attributes.fields.length === 0 && (
          <p className="text-sm text-ink-muted">Options such as size or color.</p>
        )}
        {attributes.fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
            <TextField
              label={`Attribute ${index + 1} name`}
              placeholder="size"
              error={errors.attributes?.[index]?.key?.message}
              {...form.register(`attributes.${index}.key`)}
            />
            <TextField
              label={`Attribute ${index + 1} value`}
              placeholder="42"
              error={errors.attributes?.[index]?.value?.message}
              {...form.register(`attributes.${index}.value`)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="mt-7"
              aria-label={`Remove attribute ${index + 1}`}
              onClick={() => attributes.remove(index)}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        {attributes.fields.length < 10 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => attributes.append({ key: '', value: '' })}
          >
            <Plus aria-hidden className="size-4" /> Add attribute
          </Button>
        )}
        {errors.attributes?.message && (
          <p className="text-xs text-danger">{errors.attributes.message}</p>
        )}
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {variant ? 'Save variant' : 'Add variant'}
        </Button>
      </div>
    </form>
  );
}

export function VariantsPanel({
  organizationId,
  product,
  canEdit,
}: {
  organizationId: string;
  product: ProductDetail;
  canEdit: boolean;
}) {
  const notify = useToast();
  const variants = useVariants(organizationId, product.id);
  const update = useUpdateVariant(organizationId, product.id);
  const [editing, setEditing] = useState<Variant | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Variant | null>(null);
  const archived = product.status === 'ARCHIVED';

  const changeStatus = async (variant: Variant, status: VariantStatus) => {
    try {
      await update.mutateAsync({ id: variant.id, change: { status } });
      notify(`${variant.sku} is now ${VARIANT_STATUS_LABELS[status].label.toLowerCase()}`);
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setArchiving(null);
    }
  };

  return (
    <Panel
      title="Variants"
      description="Each variant is a sellable item with its own SKU. Archiving frees the SKU for reuse."
      actions={
        canEdit && !archived ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden className="size-4" /> Add variant
          </Button>
        ) : undefined
      }
    >
      {variants.isPending ? (
        <LoadingRows label="Loading variants" />
      ) : variants.isError ? (
        <div className="p-4">
          <Alert tone="error">{describeError(variants.error)}</Alert>
        </div>
      ) : variants.data.items.length === 0 ? (
        <EmptyState
          title="No variants yet"
          description="Add at least one active variant before activating the product."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Variants">
            <thead className="bg-canvas text-left text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">SKU</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Attributes</th>
                <th className="px-4 py-2.5 text-right font-medium">Price</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                {canEdit && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {variants.data.items.map((variant) => (
                <tr key={variant.id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{variant.sku}</td>
                  <td className="px-4 py-2.5">{variant.name}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(variant.attributes).map(([key, value]) => (
                        <Badge key={key}>
                          {key}: {value}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMoney(variant.effectivePrice, product.currency)}
                    {variant.price === null && (
                      <span className="block text-xs text-ink-muted">base price</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={VARIANT_STATUS_LABELS[variant.status].tone}>
                      {VARIANT_STATUS_LABELS[variant.status].label}
                    </Badge>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {variant.status !== 'ARCHIVED' && (
                          <Button variant="ghost" size="sm" onClick={() => setEditing(variant)}>
                            Edit
                          </Button>
                        )}
                        {variantStatusActions(variant.status).map((action) => (
                          <Button
                            key={action.to}
                            variant="ghost"
                            size="sm"
                            disabled={update.isPending || archived}
                            onClick={() =>
                              action.destructive
                                ? setArchiving(variant)
                                : void changeStatus(variant, action.to)
                            }
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={editing !== null}
        title={editing === 'new' ? 'Add variant' : 'Edit variant'}
        size="lg"
        onClose={() => setEditing(null)}
      >
        {editing !== null && (
          <VariantForm
            organizationId={organizationId}
            product={product}
            variant={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.sku ?? 'variant'}?`}
        description="It can no longer be sold, and its SKU becomes available to other variants. You can restore it later as inactive."
        confirmLabel="Archive variant"
        pending={update.isPending}
        onConfirm={() => archiving && void changeStatus(archiving, 'ARCHIVED')}
        onCancel={() => setArchiving(null)}
      />
    </Panel>
  );
}
