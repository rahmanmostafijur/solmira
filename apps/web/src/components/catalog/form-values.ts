import {
  TAX_CATEGORIES,
  barcodeSchema,
  skuSchema,
  type CreateProductRequest,
  type CreateVariantRequest,
  type ProductDetail,
  type UpdateProductRequest,
  type UpdateVariantRequest,
  type Variant,
} from '@solmira/contracts';
import { z } from 'zod';
import { fromMinorUnits, toMinorUnits } from '../../lib/money';

/**
 * Form state is text, exactly as typed; the API takes typed values (integer minor units, nulls
 * for cleared fields). These schemas validate the text with the API's own rules, and the mappers
 * below translate. Edits send only the fields that changed.
 */

const wholeNumber = (max: number) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d+$/.test(v) && Number(v) <= max),
      `A whole number up to ${max.toLocaleString('en')}`,
    );

const blankToNull = (value: string) => (value === '' ? null : value);
const measure = (value: string) => (value === '' ? null : Number(value));
const firstIssue = (schema: z.ZodType, value: unknown) =>
  schema.safeParse(value).error?.issues[0]?.message;

function moneyIssue(
  value: string,
  currency: string,
  ctx: z.RefinementCtx,
  path: string[],
  required: boolean,
) {
  if (value === '' && !required) return;
  if (toMinorUnits(value, currency) === null) {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `Enter an amount such as ${fromMinorUnits(1250, currency)}`,
    });
  }
}

// ---- products -----------------------------------------------------------------------------------

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a product name').max(200),
    brand: z.string().trim().max(100),
    description: z.string().trim().max(5000),
    categoryId: z.string(),
    supplierId: z.string(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a 3-letter code such as USD'),
    basePrice: z.string().trim(),
    baseCost: z.string().trim(),
    taxCategory: z.enum(TAX_CATEGORIES),
    weightGrams: wholeNumber(1_000_000),
    lengthMm: wholeNumber(100_000),
    widthMm: wholeNumber(100_000),
    heightMm: wholeNumber(100_000),
    initialVariant: z.object({ sku: z.string().trim(), name: z.string().trim().max(120) }),
  })
  .superRefine((values, ctx) => {
    moneyIssue(values.basePrice, values.currency, ctx, ['basePrice'], true);
    moneyIssue(values.baseCost, values.currency, ctx, ['baseCost'], false);
    if (values.initialVariant.sku !== '') {
      const message = firstIssue(skuSchema, values.initialVariant.sku);
      if (message) ctx.addIssue({ code: 'custom', path: ['initialVariant', 'sku'], message });
    }
  });

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormValues = z.output<typeof productFormSchema>;

export function productFormDefaults(
  product?: ProductDetail,
  defaultCurrency = 'USD',
): ProductFormInput {
  const currency = product?.currency ?? defaultCurrency;
  return {
    name: product?.name ?? '',
    brand: product?.brand ?? '',
    description: product?.description ?? '',
    categoryId: product?.category?.id ?? '',
    supplierId: product?.supplier?.id ?? '',
    currency,
    basePrice: product ? fromMinorUnits(product.basePrice, currency) : '',
    baseCost: product?.baseCost != null ? fromMinorUnits(product.baseCost, currency) : '',
    taxCategory: product?.taxCategory ?? 'STANDARD',
    weightGrams: product?.weightGrams?.toString() ?? '',
    lengthMm: product?.lengthMm?.toString() ?? '',
    widthMm: product?.widthMm?.toString() ?? '',
    heightMm: product?.heightMm?.toString() ?? '',
    initialVariant: { sku: '', name: '' },
  };
}

function productFields(values: ProductFormValues) {
  return {
    name: values.name,
    brand: blankToNull(values.brand),
    description: blankToNull(values.description),
    categoryId: blankToNull(values.categoryId),
    supplierId: blankToNull(values.supplierId),
    currency: values.currency,
    basePrice: toMinorUnits(values.basePrice, values.currency) ?? 0,
    baseCost: values.baseCost === '' ? null : toMinorUnits(values.baseCost, values.currency),
    taxCategory: values.taxCategory,
    weightGrams: measure(values.weightGrams),
    lengthMm: measure(values.lengthMm),
    widthMm: measure(values.widthMm),
    heightMm: measure(values.heightMm),
  };
}

export function toCreateProductRequest(values: ProductFormValues): CreateProductRequest {
  const { sku, name } = values.initialVariant;
  return {
    ...productFields(values),
    ...(sku ? { initialVariant: { sku, ...(name ? { name } : {}) } } : {}),
  };
}

/** Only the changed fields, or null when the form matches the saved product. */
export function toUpdateProductRequest(
  values: ProductFormValues,
  original: ProductDetail,
): UpdateProductRequest | null {
  const next = productFields(values);
  const before = productFields(productFormSchema.parse(productFormDefaults(original)));
  const changed = Object.fromEntries(
    Object.entries(next).filter(([key, value]) => before[key as keyof typeof before] !== value),
  );
  return Object.keys(changed).length > 0 ? (changed as UpdateProductRequest) : null;
}

// ---- variants -----------------------------------------------------------------------------------

export function variantFormSchema(currency: string) {
  return z
    .object({
      sku: z.string().trim(),
      name: z.string().trim().min(1, 'Enter a variant name').max(120),
      barcode: z.string().trim(),
      price: z.string().trim(),
      cost: z.string().trim(),
      weightGrams: wholeNumber(1_000_000),
      attributes: z
        .array(z.object({ key: z.string().trim().max(40), value: z.string().trim().max(80) }))
        .max(10, 'At most 10 attributes'),
    })
    .superRefine((values, ctx) => {
      const skuMessage = firstIssue(skuSchema, values.sku);
      if (skuMessage) ctx.addIssue({ code: 'custom', path: ['sku'], message: skuMessage });
      if (values.barcode !== '') {
        const message = firstIssue(barcodeSchema, values.barcode);
        if (message) ctx.addIssue({ code: 'custom', path: ['barcode'], message });
      }
      moneyIssue(values.price, currency, ctx, ['price'], false);
      moneyIssue(values.cost, currency, ctx, ['cost'], false);
      const seen = new Set<string>();
      values.attributes.forEach(({ key, value }, index) => {
        if (key === '' && value === '') return;
        if (key === '')
          ctx.addIssue({
            code: 'custom',
            path: ['attributes', index, 'key'],
            message: 'Name this attribute',
          });
        if (value === '')
          ctx.addIssue({
            code: 'custom',
            path: ['attributes', index, 'value'],
            message: 'Enter a value',
          });
        const normalized = key.toLowerCase();
        if (key !== '' && seen.has(normalized)) {
          ctx.addIssue({
            code: 'custom',
            path: ['attributes', index, 'key'],
            message: 'Each attribute appears once',
          });
        }
        seen.add(normalized);
      });
    });
}

export type VariantFormInput = z.input<ReturnType<typeof variantFormSchema>>;
export type VariantFormValues = z.output<ReturnType<typeof variantFormSchema>>;

export function variantFormDefaults(currency: string, variant?: Variant): VariantFormInput {
  return {
    sku: variant?.sku ?? '',
    name: variant?.name ?? '',
    barcode: variant?.barcode ?? '',
    price: variant?.price != null ? fromMinorUnits(variant.price, currency) : '',
    cost: variant?.cost != null ? fromMinorUnits(variant.cost, currency) : '',
    weightGrams: variant?.weightGrams?.toString() ?? '',
    attributes: Object.entries(variant?.attributes ?? {}).map(([key, value]) => ({ key, value })),
  };
}

function attributesOf(values: VariantFormValues): Record<string, string> {
  return Object.fromEntries(
    values.attributes.filter((row) => row.key !== '').map((row) => [row.key, row.value]),
  );
}

const sameAttributes = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function variantFields(values: VariantFormValues, currency: string) {
  return {
    sku: values.sku,
    name: values.name,
    barcode: blankToNull(values.barcode),
    price: values.price === '' ? null : toMinorUnits(values.price, currency),
    cost: values.cost === '' ? null : toMinorUnits(values.cost, currency),
    weightGrams: measure(values.weightGrams),
  };
}

export function toCreateVariantRequest(
  values: VariantFormValues,
  currency: string,
): CreateVariantRequest {
  return { ...variantFields(values, currency), attributes: attributesOf(values) };
}

export function toUpdateVariantRequest(
  values: VariantFormValues,
  original: Variant,
  currency: string,
): UpdateVariantRequest | null {
  const next = variantFields(values, currency);
  const change: Record<string, unknown> = {};
  // The server stores SKUs upper-cased; "abc-1" against "ABC-1" is not a change.
  if (next.sku.toUpperCase() !== original.sku) change.sku = next.sku;
  if (next.name !== original.name) change.name = next.name;
  if (next.barcode !== original.barcode) change.barcode = next.barcode;
  if (next.price !== original.price) change.price = next.price;
  if (next.cost !== original.cost) change.cost = next.cost;
  if (next.weightGrams !== original.weightGrams) change.weightGrams = next.weightGrams;
  const attributes = attributesOf(values);
  if (!sameAttributes(attributes, original.attributes)) change.attributes = attributes;
  return Object.keys(change).length > 0 ? (change as UpdateVariantRequest) : null;
}
