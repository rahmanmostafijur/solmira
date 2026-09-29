import type { ProductDetail, Variant } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import {
  productFormDefaults,
  productFormSchema,
  toCreateProductRequest,
  toCreateVariantRequest,
  toUpdateProductRequest,
  toUpdateVariantRequest,
  variantFormDefaults,
  variantFormSchema,
} from './form-values';

const product: ProductDetail = {
  id: 'p1',
  name: 'Trail Shoe',
  slug: 'trail-shoe',
  brand: 'Stride',
  status: 'ACTIVE',
  basePrice: 8999,
  currency: 'USD',
  category: { id: 'c1', name: 'Footwear' },
  supplier: null,
  variantCount: 1,
  primarySku: 'TS-1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  description: null,
  baseCost: 4000,
  taxCategory: 'STANDARD',
  weightGrams: 800,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  imageCount: 0,
  archivedAt: null,
};

const variant: Variant = {
  id: 'v1',
  productId: 'p1',
  sku: 'TS-40',
  name: 'Size 40',
  barcode: null,
  attributes: { size: '40' },
  price: null,
  effectivePrice: 8999,
  cost: null,
  weightGrams: null,
  status: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('product form values', () => {
  it('turns typed text into an API request with minor units and nulls', () => {
    const values = productFormSchema.parse({
      ...productFormDefaults(undefined, 'usd'),
      name: ' Canvas Tote ',
      basePrice: '24.5',
      weightGrams: '350',
      initialVariant: { sku: 'tote-nat', name: '' },
    });
    expect(toCreateProductRequest(values)).toEqual({
      name: 'Canvas Tote',
      brand: null,
      description: null,
      categoryId: null,
      supplierId: null,
      currency: 'USD',
      basePrice: 2450,
      baseCost: null,
      taxCategory: 'STANDARD',
      weightGrams: 350,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      initialVariant: { sku: 'tote-nat' },
    });
  });

  it('reports invalid prices, measures and SKUs on their fields', () => {
    const result = productFormSchema.safeParse({
      ...productFormDefaults(),
      name: 'X',
      basePrice: '12.345',
      baseCost: 'free',
      weightGrams: '-5',
      initialVariant: { sku: 'has space', name: '' },
    });
    const paths = result.error?.issues.map((issue) => issue.path.join('.')).sort();
    expect(paths).toEqual(['baseCost', 'basePrice', 'initialVariant.sku', 'weightGrams']);
  });

  it('sends only the fields that changed when editing', () => {
    const unchanged = productFormSchema.parse(productFormDefaults(product));
    expect(toUpdateProductRequest(unchanged, product)).toBeNull();

    const edited = productFormSchema.parse({
      ...productFormDefaults(product),
      basePrice: '95.00',
      categoryId: '',
      weightGrams: '',
    });
    expect(toUpdateProductRequest(edited, product)).toEqual({
      basePrice: 9500,
      categoryId: null,
      weightGrams: null,
    });
  });
});

describe('variant form values', () => {
  const schema = variantFormSchema('USD');

  it('maps attributes and an empty price (inherit the product price) to the request', () => {
    const values = schema.parse({
      ...variantFormDefaults('USD'),
      sku: 'ts-41',
      name: 'Size 41',
      attributes: [
        { key: 'size', value: '41' },
        { key: '', value: '' },
      ],
    });
    expect(toCreateVariantRequest(values, 'USD')).toEqual({
      sku: 'ts-41',
      name: 'Size 41',
      barcode: null,
      price: null,
      cost: null,
      weightGrams: null,
      attributes: { size: '41' },
    });
  });

  it('rejects half-filled and duplicate attributes and invalid barcodes', () => {
    const result = schema.safeParse({
      ...variantFormDefaults('USD'),
      sku: 'OK-1',
      name: 'x',
      barcode: '12345',
      attributes: [
        { key: 'size', value: '' },
        { key: 'Size', value: 'L' },
      ],
    });
    const paths = result.error?.issues.map((issue) => issue.path.join('.')).sort();
    expect(paths).toEqual(['attributes.0.value', 'attributes.1.key', 'barcode']);
  });

  it('treats a lower-case SKU equal to the stored one as unchanged', () => {
    const values = schema.parse({ ...variantFormDefaults('USD', variant), sku: 'ts-40' });
    expect(toUpdateVariantRequest(values, variant, 'USD')).toBeNull();
    const priced = schema.parse({
      ...variantFormDefaults('USD', variant),
      price: '99.99',
      attributes: [
        { key: 'size', value: '40' },
        { key: 'color', value: 'Black' },
      ],
    });
    expect(toUpdateVariantRequest(priced, variant, 'USD')).toEqual({
      price: 9999,
      attributes: { size: '40', color: 'Black' },
    });
  });
});
