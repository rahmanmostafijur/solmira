import { z } from 'zod';
import { paginationQuerySchema, searchTermSchema, sortDirectionSchema } from './pagination.js';

// ---- shared value rules ------------------------------------------------------------------------

/** Money is an integer amount in the currency's minor unit (cents): never a float. */
export const moneySchema = z
  .number()
  .int('Use whole minor units (e.g. cents)')
  .min(0)
  .max(1_000_000_000_000);
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code');
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a 2-letter ISO 3166 country code');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const catalogSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(slugPattern, 'Lowercase letters, numbers and hyphens only');
const positiveMeasure = (max: number) => z.number().int().min(0).max(max).nullable().optional();
const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date());

/**
 * SKUs are stored trimmed and upper-cased, so "sku-100 " and "SKU-100" are the same code. That
 * normalisation is intentional and documented; nothing else about the code is changed.
 */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,63}$/, 'Letters, numbers and . _ / - only, up to 64 characters');

/** GTIN-8/12/13/14 (EAN, UPC) with a valid check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
export const barcodeSchema = z.string().trim().refine(isValidGtin, 'Enter a valid EAN/UPC barcode');

// ---- categories ---------------------------------------------------------------------------------

export const CATEGORY_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];
/** Root, child, grandchild. Deeper trees add navigation cost without real merchandising value. */
export const MAX_CATEGORY_DEPTH = 3;

export const createCategoryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: catalogSlugSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  description: optionalText(500),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = createCategoryRequestSchema
  .extend({ status: z.enum(CATEGORY_STATUSES) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const categoryListQuerySchema = paginationQuerySchema.extend({
  search: searchTermSchema,
  status: z.enum(CATEGORY_STATUSES).optional(),
  parentId: z.uuid().optional(),
});
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  sortOrder: number;
  status: CategoryStatus;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- suppliers ----------------------------------------------------------------------------------

export const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
export const PAYMENT_TERMS = [
  'PREPAID',
  'COD',
  'NET_15',
  'NET_30',
  'NET_45',
  'NET_60',
  'NET_90',
] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/**
 * Phone numbers are kept exactly as entered (after trimming): formats vary by country and the
 * original is what a buyer reads aloud. Only the character set and digit count are validated.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ().-]+$/, 'Use digits, spaces and + ( ) - . only')
  .refine((value) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  }, 'A phone number has 7 to 15 digits');

const supplierFields = {
  companyName: z.string().trim().min(1, 'Enter the company name').max(200),
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Enter a valid email address').max(254))
    .nullable()
    .optional(),
  phone: phoneSchema.nullable().optional(),
  addressLine: optionalText(200),
  city: optionalText(100),
  country: countryCodeSchema.nullable().optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  leadTimeDays: z.number().int('Whole days only').min(0).max(365).optional(),
  notes: optionalText(2000),
};

export const createSupplierRequestSchema = z.object(supplierFields);
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

export const updateSupplierRequestSchema = z
  .object({ ...supplierFields, status: z.enum(SUPPLIER_STATUSES) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const supplierListQuerySchema = paginationQuerySchema.extend({
  search: searchTermSchema,
  status: z.enum(SUPPLIER_STATUSES).optional(),
  country: countryCodeSchema.optional(),
  sort: z.enum(['companyName', 'leadTimeDays', 'createdAt', 'updatedAt']).default('companyName'),
  direction: sortDirectionSchema.default('asc'),
});
export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;

export interface Supplier {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  paymentTerms: PaymentTerms;
  leadTimeDays: number;
  status: SupplierStatus;
  notes: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- warehouses ---------------------------------------------------------------------------------

export const WAREHOUSE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];

/** Short operational code printed on labels and pick lists, unique within an organization. */
export const warehouseCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, '2-20 characters: letters, numbers and hyphens');

const warehouseFields = {
  code: warehouseCodeSchema,
  name: z.string().trim().min(1).max(120),
  description: optionalText(500),
  addressLine: optionalText(200),
  city: optionalText(100),
  country: countryCodeSchema.nullable().optional(),
  /** An organization member id (not a user id): managers are people in this organization. */
  managerMemberId: z.uuid().nullable().optional(),
};

export const createWarehouseRequestSchema = z.object(warehouseFields);
export type CreateWarehouseRequest = z.infer<typeof createWarehouseRequestSchema>;

export const updateWarehouseRequestSchema = z
  .object({ ...warehouseFields, status: z.enum(WAREHOUSE_STATUSES) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateWarehouseRequest = z.infer<typeof updateWarehouseRequestSchema>;

export const warehouseListQuerySchema = paginationQuerySchema.extend({
  search: searchTermSchema,
  status: z.enum(WAREHOUSE_STATUSES).optional(),
  sort: z.enum(['code', 'name', 'createdAt']).default('code'),
  direction: sortDirectionSchema.default('asc'),
});
export type WarehouseListQuery = z.infer<typeof warehouseListQuerySchema>;

export interface WarehouseManager {
  memberId: string;
  fullName: string;
  email: string;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  manager: WarehouseManager | null;
  status: WarehouseStatus;
  createdAt: string;
  updatedAt: string;
}

// ---- products -----------------------------------------------------------------------------------

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const TAX_CATEGORIES = ['STANDARD', 'REDUCED', 'ZERO', 'EXEMPT'] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

/**
 * Allowed lifecycle moves. There is no path back to DRAFT and no hard delete: once a product has
 * been sellable, orders may reference it, so it is retired (ARCHIVED) instead of removed.
 */
export const PRODUCT_STATUS_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> =
  {
    DRAFT: ['ACTIVE', 'ARCHIVED'],
    ACTIVE: ['INACTIVE', 'ARCHIVED'],
    INACTIVE: ['ACTIVE', 'ARCHIVED'],
    ARCHIVED: ['INACTIVE'],
  };

export function canTransitionProduct(from: ProductStatus, to: ProductStatus): boolean {
  return from === to || PRODUCT_STATUS_TRANSITIONS[from].includes(to);
}

const dimensionFields = {
  weightGrams: positiveMeasure(1_000_000),
  lengthMm: positiveMeasure(100_000),
  widthMm: positiveMeasure(100_000),
  heightMm: positiveMeasure(100_000),
};

const productFields = {
  name: z.string().trim().min(1, 'Enter a product name').max(200),
  slug: catalogSlugSchema.optional(),
  description: optionalText(5000),
  brand: optionalText(100),
  categoryId: z.uuid().nullable().optional(),
  supplierId: z.uuid().nullable().optional(),
  baseCost: moneySchema.nullable().optional(),
  basePrice: moneySchema,
  currency: currencySchema,
  taxCategory: z.enum(TAX_CATEGORIES).optional(),
  ...dimensionFields,
};

/** The optional first variant: simple products are one variant with the product's own price. */
const initialVariantSchema = z.object({
  sku: skuSchema,
  name: z.string().trim().min(1).max(120).optional(),
  barcode: barcodeSchema.nullable().optional(),
});

export const createProductRequestSchema = z.object({
  ...productFields,
  initialVariant: initialVariantSchema.optional(),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .object({ ...productFields, status: z.enum(PRODUCT_STATUSES) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productSortFields = ['name', 'basePrice', 'createdAt', 'updatedAt'] as const;

export const productListQuerySchema = paginationQuerySchema
  .extend({
    search: searchTermSchema,
    status: z.enum(PRODUCT_STATUSES).optional(),
    categoryId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    brand: z.string().trim().min(1).max(100).optional(),
    sku: z.string().trim().toUpperCase().min(1).max(64).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    sort: z.enum(productSortFields).default('updatedAt'),
    direction: sortDirectionSchema.default('desc'),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    path: ['maxPrice'],
    message: 'maxPrice must be at least minPrice',
  })
  .refine(
    (q) => !q.createdFrom || !q.createdTo || new Date(q.createdFrom) <= new Date(q.createdTo),
    {
      path: ['createdTo'],
      message: 'createdTo must be after createdFrom',
    },
  );
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const bulkProductStatusRequestSchema = z.object({
  productIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate product ids'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
});
export type BulkProductStatusRequest = z.infer<typeof bulkProductStatusRequestSchema>;

export interface BulkProductStatusResult {
  updated: string[];
  skipped: { id: string; reason: string }[];
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  status: ProductStatus;
  basePrice: number;
  currency: string;
  category: { id: string; name: string } | null;
  supplier: { id: string; companyName: string } | null;
  variantCount: number;
  /** The first active variant's SKU, for display in lists. */
  primarySku: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  baseCost: number | null;
  taxCategory: TaxCategory;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  imageCount: number;
  archivedAt: string | null;
}

// ---- variants -----------------------------------------------------------------------------------

export const VARIANT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const VARIANT_STATUS_TRANSITIONS: Readonly<Record<VariantStatus, readonly VariantStatus[]>> =
  {
    ACTIVE: ['INACTIVE', 'ARCHIVED'],
    INACTIVE: ['ACTIVE', 'ARCHIVED'],
    ARCHIVED: ['INACTIVE'],
  };

export function canTransitionVariant(from: VariantStatus, to: VariantStatus): boolean {
  return from === to || VARIANT_STATUS_TRANSITIONS[from].includes(to);
}

/** Option values such as { size: "42", color: "Black" }. Small and flat on purpose. */
export const variantAttributesSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80))
  .refine((attributes) => Object.keys(attributes).length <= 10, 'At most 10 attributes');

const variantFields = {
  sku: skuSchema,
  name: z.string().trim().min(1).max(120),
  barcode: barcodeSchema.nullable().optional(),
  attributes: variantAttributesSchema.optional(),
  /** null inherits the product's base price. */
  price: moneySchema.nullable().optional(),
  cost: moneySchema.nullable().optional(),
  weightGrams: positiveMeasure(1_000_000),
};

export const createVariantRequestSchema = z.object(variantFields);
export type CreateVariantRequest = z.infer<typeof createVariantRequestSchema>;

export const updateVariantRequestSchema = z
  .object({ ...variantFields, status: z.enum(VARIANT_STATUSES) })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateVariantRequest = z.infer<typeof updateVariantRequestSchema>;

export const variantListQuerySchema = paginationQuerySchema.extend({
  search: searchTermSchema,
  status: z.enum(VARIANT_STATUSES).optional(),
});
export type VariantListQuery = z.infer<typeof variantListQuerySchema>;

export interface Variant {
  id: string;
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  attributes: Record<string, string>;
  price: number | null;
  /** The price actually charged: the variant price, or the product base price. */
  effectivePrice: number;
  cost: number | null;
  weightGrams: number | null;
  status: VariantStatus;
  createdAt: string;
  updatedAt: string;
}

// ---- product images -----------------------------------------------------------------------------

/**
 * Accepted image formats, identified by content (magic bytes), not by name or declared type.
 * SVG is deliberately excluded: it can carry script.
 */
export const IMAGE_FORMATS = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
} as const;
export type ImageContentType = keyof typeof IMAGE_FORMATS;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 12;

export const updateImageRequestSchema = z
  .object({ altText: z.string().trim().max(250).nullable() })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

export const reorderImagesRequestSchema = z.object({
  imageIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_IMAGES_PER_PRODUCT)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate image ids'),
});

export const uploadImageFieldsSchema = z.object({ altText: z.string().trim().max(250).optional() });

export interface ProductImage {
  id: string;
  /** Short-lived signed URL. The underlying object key is never exposed. */
  url: string;
  urlExpiresAt: string;
  originalFilename: string;
  contentType: ImageContentType;
  fileSize: number;
  sortOrder: number;
  altText: string | null;
  isPrimary: boolean;
  createdAt: string;
}
