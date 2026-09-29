import { describe, expect, it } from 'vitest';
import {
  PRODUCT_STATUSES,
  canTransitionProduct,
  canTransitionVariant,
  createProductRequestSchema,
  createSupplierRequestSchema,
  isValidGtin,
  phoneSchema,
  productListQuerySchema,
  skuSchema,
  warehouseCodeSchema,
} from './catalog.js';

describe('SKU rules', () => {
  it('normalises case and surrounding whitespace, nothing else', () => {
    expect(skuSchema.parse('  sku-100/blk.42 ')).toBe('SKU-100/BLK.42');
  });

  it.each(['', ' ', '-LEADING', 'has space', 'semi;colon', 'x'.repeat(65)])(
    'rejects %j',
    (value) => {
      expect(skuSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('barcodes', () => {
  it('accepts real GTINs and rejects bad check digits', () => {
    expect(isValidGtin('4006381333931')).toBe(true); // EAN-13
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
  });
});

describe('product lifecycle', () => {
  it('allows the documented moves and never returns to draft', () => {
    expect(canTransitionProduct('DRAFT', 'ACTIVE')).toBe(true);
    expect(canTransitionProduct('ACTIVE', 'INACTIVE')).toBe(true);
    expect(canTransitionProduct('ARCHIVED', 'INACTIVE')).toBe(true);
    for (const from of PRODUCT_STATUSES) {
      if (from !== 'DRAFT') expect(canTransitionProduct(from, 'DRAFT')).toBe(false);
    }
    expect(canTransitionProduct('ARCHIVED', 'ACTIVE')).toBe(false);
  });

  it('keeps variants restorable but not resurrected straight to active', () => {
    expect(canTransitionVariant('ARCHIVED', 'INACTIVE')).toBe(true);
    expect(canTransitionVariant('ARCHIVED', 'ACTIVE')).toBe(false);
  });
});

describe('product payloads', () => {
  it('requires integer minor-unit money and a valid currency', () => {
    const base = { name: 'Classic Running Shoe', currency: 'usd' };
    expect(createProductRequestSchema.parse({ ...base, basePrice: 8999 }).currency).toBe('USD');
    expect(createProductRequestSchema.safeParse({ ...base, basePrice: 89.99 }).success).toBe(false);
    expect(createProductRequestSchema.safeParse({ ...base, basePrice: -1 }).success).toBe(false);
  });

  it('drops fields the API does not accept, such as organizationId', () => {
    const parsed = createProductRequestSchema.parse({
      name: 'Tote',
      basePrice: 1500,
      currency: 'EUR',
      organizationId: '00000000-0000-0000-0000-000000000000',
    });
    expect(parsed).not.toHaveProperty('organizationId');
  });
});

describe('list query validation', () => {
  it('applies defaults, coerces numbers and caps the page size', () => {
    const query = productListQuerySchema.parse({ page: '2', minPrice: '1000' });
    expect(query).toMatchObject({
      page: 2,
      pageSize: 25,
      minPrice: 1000,
      sort: 'updatedAt',
      direction: 'desc',
    });
    expect(productListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('rejects unknown sort fields and inverted ranges', () => {
    expect(productListQuerySchema.safeParse({ sort: 'password_hash' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ minPrice: '500', maxPrice: '100' }).success).toBe(
      false,
    );
    expect(
      productListQuerySchema.safeParse({ createdFrom: '2026-09-30', createdTo: '2026-09-01' })
        .success,
    ).toBe(false);
  });

  it('treats a blank search as no search', () => {
    expect(productListQuerySchema.parse({ search: '   ' }).search).toBeUndefined();
  });
});

describe('supplier validation', () => {
  it('keeps phone numbers as entered while checking digit count', () => {
    expect(phoneSchema.parse(' +880 (2) 5566-7788 ')).toBe('+880 (2) 5566-7788');
    expect(phoneSchema.safeParse('12345').success).toBe(false);
    expect(phoneSchema.safeParse('call me maybe').success).toBe(false);
  });

  it('normalises email case, validates lead time and country', () => {
    const parsed = createSupplierRequestSchema.parse({
      companyName: 'Dhaka Leather Works',
      email: ' Orders@DhakaLeather.example ',
      country: 'bd',
      leadTimeDays: 21,
    });
    expect(parsed).toMatchObject({ email: 'orders@dhakaleather.example', country: 'BD' });
    expect(
      createSupplierRequestSchema.safeParse({ companyName: 'X', leadTimeDays: 400 }).success,
    ).toBe(false);
    expect(
      createSupplierRequestSchema.safeParse({ companyName: 'X', leadTimeDays: 2.5 }).success,
    ).toBe(false);
  });
});

describe('warehouse codes', () => {
  it('are upper-cased and restricted to a label-friendly alphabet', () => {
    expect(warehouseCodeSchema.parse(' wh-dhk ')).toBe('WH-DHK');
    expect(warehouseCodeSchema.safeParse('W').success).toBe(false);
    expect(warehouseCodeSchema.safeParse('WH DHK').success).toBe(false);
  });
});
