'use client';

import type { Variant } from '@solmira/contracts';
import { useState } from 'react';
import { SearchInput } from '@/components/data-table/search-input';
import { SelectField } from '@/components/ui/field';
import { useProduct, useProducts, useVariants } from '@/lib/catalog-queries';

/** Products offered per search; typing narrows the list rather than paging through it. */
const PRODUCT_CHOICES = 20;

interface VariantPickerProps {
  organizationId: string;
  /** The order currency: a cost is suggested only from a product priced in the same currency. */
  currency: string;
  productId: string;
  variantId: string;
  productError?: string;
  variantError?: string;
  onProductChange: (productId: string) => void;
  /** `suggestedCost` is the variant cost, else the product base cost, in minor units, or null. */
  onVariantChange: (variantId: string, suggestedCost: number | null) => void;
}

/** Product search, then one of its active variants: what a purchase order line orders. */
export function VariantPicker({
  organizationId,
  currency,
  productId,
  variantId,
  productError,
  variantError,
  onProductChange,
  onVariantChange,
}: VariantPickerProps) {
  const [search, setSearch] = useState('');
  const products = useProducts(organizationId, {
    search: search || undefined,
    pageSize: PRODUCT_CHOICES,
    sort: 'name',
    direction: 'asc',
  });
  const chosen = productId !== '';
  const product = useProduct(organizationId, productId, chosen);
  const variants = useVariants(organizationId, productId, chosen);

  const listed = (products.data?.items ?? []).filter((p) => p.status !== 'ARCHIVED');
  // The chosen product stays selectable when a new search no longer lists it.
  const productChoices =
    product.data && !listed.some((p) => p.id === product.data.id)
      ? [product.data, ...listed]
      : listed;
  const variantChoices = (variants.data?.items ?? []).filter((v) => v.status === 'ACTIVE');

  const suggestedCost = (variant: Variant): number | null => {
    const productCurrency =
      product.data?.currency ?? listed.find((p) => p.id === productId)?.currency;
    if (!productCurrency || productCurrency !== currency.trim().toUpperCase()) return null;
    return variant.cost ?? product.data?.baseCost ?? null;
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <span className="block text-sm font-medium">Find product</span>
        <SearchInput label="Name or SKU…" value={search} onChange={setSearch} />
      </div>
      <SelectField
        label="Product"
        value={productId}
        disabled={products.isPending && !chosen}
        error={productError}
        hint={products.isSuccess && productChoices.length === 0 ? 'No product matches' : undefined}
        onChange={(e) => onProductChange(e.target.value)}
      >
        <option value="">Choose a product</option>
        {productChoices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.primarySku ? ` (${p.primarySku})` : ''}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Variant"
        value={variantId}
        disabled={!chosen || variants.isPending}
        error={variantError}
        hint={
          variants.isSuccess && variantChoices.length === 0
            ? 'This product has no active variant'
            : undefined
        }
        onChange={(e) => {
          const variant = variantChoices.find((v) => v.id === e.target.value);
          onVariantChange(e.target.value, variant ? suggestedCost(variant) : null);
        }}
      >
        <option value="">Choose a variant</option>
        {variantChoices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.sku} · {v.name}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
