import { Inject, Injectable } from '@nestjs/common';
import {
  canTransitionProduct,
  type BulkProductStatusRequest,
  type BulkProductStatusResult,
  type CreateProductRequest,
  type Page,
  type ProductDetail,
  type ProductListQuery,
  type ProductStatus,
  type ProductSummary,
  type UpdateProductRequest,
} from '@solmira/contracts';
import { ConflictError, type TenantAuthContext } from '@solmira/service-kit';
import { and, asc, count, desc, eq, gte, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  contains,
  escapeLike,
  iso,
  offsetOf,
  orNotFound,
  pageOf,
  rethrowConflict,
} from '../common/query.js';
import { slugify, withRandomSuffix } from '../common/slug.js';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import {
  categories,
  productImages,
  productVariants,
  products,
  suppliers,
} from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { assertProductReferences } from './product-references.js';

type ProductRow = typeof products.$inferSelect;

export const PRODUCT_CONFLICTS = {
  products_org_slug_key: 'Another product already uses this URL name',
  product_variants_org_sku_live_key: 'This SKU is already used by another variant',
  product_variants_org_barcode_live_key: 'This barcode is already used by another variant',
};

// Per-row aggregates as correlated subqueries: evaluated only for the rows on the current page
// and served by the (organization_id, product_id) indexes, so a list stays one round trip.
const variantCount = sql<number>`(select count(*)::int from ${productVariants} v
  where v.organization_id = ${products.organizationId} and v.product_id = ${products.id} and v.status <> 'ARCHIVED')`;
const primarySku = sql<string | null>`(select v.sku from ${productVariants} v
  where v.organization_id = ${products.organizationId} and v.product_id = ${products.id} and v.status = 'ACTIVE'
  order by v.created_at, v.id limit 1)`;
const imageCount = sql<number>`(select count(*)::int from ${productImages} i
  where i.organization_id = ${products.organizationId} and i.product_id = ${products.id})`;

const summaryColumns = {
  product: products,
  categoryName: categories.name,
  supplierName: suppliers.companyName,
  variantCount,
  primarySku,
};

const SORT_COLUMNS = {
  name: sql`lower(${products.name})`,
  basePrice: products.basePriceMinor,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
} as const;

type SummaryRow = {
  product: ProductRow;
  categoryName: string | null;
  supplierName: string | null;
  variantCount: number;
  primarySku: string | null;
};

function toSummary(row: SummaryRow): ProductSummary {
  const { product } = row;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    status: product.status,
    basePrice: product.basePriceMinor,
    currency: product.currency,
    category:
      product.categoryId && row.categoryName
        ? { id: product.categoryId, name: row.categoryName }
        : null,
    supplier:
      product.supplierId && row.supplierName
        ? { id: product.supplierId, companyName: row.supplierName }
        : null,
    variantCount: row.variantCount,
    primarySku: row.primarySku,
    createdAt: iso(product.createdAt),
    updatedAt: iso(product.updatedAt),
  };
}

/** Maps API field names (basePrice, baseCost) to columns; everything else is 1:1. */
function toColumns(input: Omit<UpdateProductRequest, 'status'>) {
  const { basePrice, baseCost, ...rest } = input;
  return {
    ...rest,
    ...(basePrice !== undefined ? { basePriceMinor: basePrice } : {}),
    ...(baseCost !== undefined ? { baseCostMinor: baseCost } : {}),
  };
}

/** A date-only upper bound ("2026-09-30") includes that whole day. */
function upperBound(value: string): { date: Date; inclusive: boolean } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const next = new Date(`${value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { date: next, inclusive: false };
  }
  return { date: new Date(value), inclusive: true };
}

@Injectable()
export class ProductsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(auth: TenantAuthContext, query: ProductListQuery): Promise<Page<ProductSummary>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = this.filters(auth, query);
      const sortColumn = SORT_COLUMNS[query.sort];
      const rows = await this.summaryQuery(tx)
        .where(where)
        .orderBy(query.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(products.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await tx
        .select({ n: count() })
        .from(products)
        .leftJoin(
          categories,
          and(
            eq(categories.organizationId, products.organizationId),
            eq(categories.id, products.categoryId),
          ),
        )
        .leftJoin(
          suppliers,
          and(
            eq(suppliers.organizationId, products.organizationId),
            eq(suppliers.id, products.supplierId),
          ),
        )
        .where(where);
      return pageOf(rows.map(toSummary), total?.n ?? 0, query);
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<ProductDetail> {
    return this.database.forTenant(auth, (tx) => this.load(tx, auth, id));
  }

  async create(auth: TenantAuthContext, input: CreateProductRequest): Promise<ProductDetail> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        await assertProductReferences(tx, auth, input);
        const { initialVariant, slug: requestedSlug, ...fields } = input;
        const slug = requestedSlug ?? (await this.freeSlug(tx, auth, slugify(input.name)));
        const id = uuidv7();
        await tx.insert(products).values({
          id,
          organizationId: auth.organizationId,
          slug,
          ...toColumns(fields),
          name: input.name,
          currency: input.currency,
          basePriceMinor: input.basePrice,
          status: 'DRAFT',
        });
        await recordEvent(tx, auth, 'product.created', {
          productId: id,
          name: input.name,
          status: 'DRAFT',
        });
        if (initialVariant) {
          const variantId = uuidv7();
          await tx.insert(productVariants).values({
            id: variantId,
            organizationId: auth.organizationId,
            productId: id,
            sku: initialVariant.sku,
            name: initialVariant.name ?? 'Default',
            barcode: initialVariant.barcode ?? null,
          });
          await recordEvent(tx, auth, 'variant.created', {
            productId: id,
            variantId,
            sku: initialVariant.sku,
          });
        }
        return this.load(tx, auth, id);
      });
    } catch (error) {
      rethrowConflict(error, PRODUCT_CONFLICTS);
    }
  }

  async update(
    auth: TenantAuthContext,
    id: string,
    input: UpdateProductRequest,
  ): Promise<ProductDetail> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const current = await this.lock(tx, auth, id);
        const { status, ...fields } = input;
        if (status && status !== current.status)
          await this.assertTransition(tx, auth, current, status);
        await assertProductReferences(tx, auth, fields);
        await tx
          .update(products)
          .set({
            ...toColumns(fields),
            ...(status && status !== current.status
              ? { status, archivedAt: status === 'ARCHIVED' ? new Date() : null }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(products.organizationId, auth.organizationId), eq(products.id, id)));
        if (status && status !== current.status) {
          await recordEvent(tx, auth, 'product.status_changed', {
            productId: id,
            fromStatus: current.status,
            toStatus: status,
          });
        }
        if (Object.keys(fields).length > 0) {
          await recordEvent(tx, auth, 'product.updated', {
            productId: id,
            fields: Object.keys(fields),
          });
        }
        return this.load(tx, auth, id);
      });
    } catch (error) {
      rethrowConflict(error, PRODUCT_CONFLICTS);
    }
  }

  /**
   * Products are never hard-deleted: future order lines will reference them. "Delete" archives,
   * which hides the product from active use and keeps it for history. Idempotent.
   */
  async archive(auth: TenantAuthContext, id: string): Promise<void> {
    const product = await this.get(auth, id);
    if (product.status !== 'ARCHIVED') await this.update(auth, id, { status: 'ARCHIVED' });
  }

  /** Applies one status to up to 100 products; each product is checked and reported on its own. */
  async bulkStatus(
    auth: TenantAuthContext,
    request: BulkProductStatusRequest,
  ): Promise<BulkProductStatusResult> {
    return this.database.forTenant(auth, async (tx) => {
      const rows = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.organizationId, auth.organizationId),
            inArray(products.id, request.productIds),
          ),
        )
        .for('update');
      const byId = new Map(rows.map((row) => [row.id, row]));
      const result: BulkProductStatusResult = { updated: [], skipped: [] };

      for (const id of request.productIds) {
        const product = byId.get(id);
        if (!product) {
          result.skipped.push({ id, reason: 'Product not found' });
          continue;
        }
        if (product.status === request.status) {
          result.updated.push(id);
          continue;
        }
        try {
          await this.assertTransition(tx, auth, product, request.status);
        } catch (error) {
          result.skipped.push({
            id,
            reason: error instanceof Error ? error.message : 'Not allowed',
          });
          continue;
        }
        await tx
          .update(products)
          .set({
            status: request.status,
            archivedAt: request.status === 'ARCHIVED' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(and(eq(products.organizationId, auth.organizationId), eq(products.id, id)));
        await recordEvent(tx, auth, 'product.status_changed', {
          productId: id,
          fromStatus: product.status,
          toStatus: request.status,
        });
        result.updated.push(id);
      }
      return result;
    });
  }

  private filters(auth: TenantAuthContext, query: ProductListQuery): SQL | undefined {
    const variantMatches = (condition: SQL) =>
      sql`exists (select 1 from ${productVariants} v where v.organization_id = ${products.organizationId}
        and v.product_id = ${products.id} and v.status <> 'ARCHIVED' and ${condition})`;
    const createdTo = query.createdTo ? upperBound(query.createdTo) : undefined;
    return and(
      eq(products.organizationId, auth.organizationId),
      query.status ? eq(products.status, query.status) : undefined,
      query.categoryId ? eq(products.categoryId, query.categoryId) : undefined,
      query.supplierId ? eq(products.supplierId, query.supplierId) : undefined,
      query.brand ? sql`lower(${products.brand}) = lower(${query.brand})` : undefined,
      query.minPrice !== undefined ? gte(products.basePriceMinor, query.minPrice) : undefined,
      query.maxPrice !== undefined ? lte(products.basePriceMinor, query.maxPrice) : undefined,
      query.createdFrom ? gte(products.createdAt, new Date(query.createdFrom)) : undefined,
      createdTo
        ? createdTo.inclusive
          ? lte(products.createdAt, createdTo.date)
          : lt(products.createdAt, createdTo.date)
        : undefined,
      query.sku ? variantMatches(sql`v.sku = ${query.sku}`) : undefined,
      query.search
        ? or(
            contains(products.name, query.search),
            contains(products.brand, query.search),
            contains(categories.name, query.search),
            contains(suppliers.companyName, query.search),
            variantMatches(sql`v.sku ilike ${`%${escapeLike(query.search)}%`}`),
          )
        : undefined,
    );
  }

  private summaryQuery(tx: OperationsTransaction) {
    return tx
      .select(summaryColumns)
      .from(products)
      .leftJoin(
        categories,
        and(
          eq(categories.organizationId, products.organizationId),
          eq(categories.id, products.categoryId),
        ),
      )
      .leftJoin(
        suppliers,
        and(
          eq(suppliers.organizationId, products.organizationId),
          eq(suppliers.id, products.supplierId),
        ),
      );
  }

  private async load(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<ProductDetail> {
    const [row] = await tx
      .select({ ...summaryColumns, imageCount })
      .from(products)
      .leftJoin(
        categories,
        and(
          eq(categories.organizationId, products.organizationId),
          eq(categories.id, products.categoryId),
        ),
      )
      .leftJoin(
        suppliers,
        and(
          eq(suppliers.organizationId, products.organizationId),
          eq(suppliers.id, products.supplierId),
        ),
      )
      .where(and(eq(products.organizationId, auth.organizationId), eq(products.id, id)));
    const found = orNotFound(row, 'Product');
    const { product } = found;
    return {
      ...toSummary(found),
      description: product.description,
      baseCost: product.baseCostMinor,
      taxCategory: product.taxCategory,
      weightGrams: product.weightGrams,
      lengthMm: product.lengthMm,
      widthMm: product.widthMm,
      heightMm: product.heightMm,
      imageCount: found.imageCount,
      archivedAt: product.archivedAt ? iso(product.archivedAt) : null,
    };
  }

  private async lock(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<ProductRow> {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.organizationId, auth.organizationId), eq(products.id, id)))
      .for('update');
    return orNotFound(row, 'Product');
  }

  private async assertTransition(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    product: ProductRow,
    to: ProductStatus,
  ): Promise<void> {
    if (!canTransitionProduct(product.status, to)) {
      throw new ConflictError(
        `A ${product.status.toLowerCase()} product cannot become ${to.toLowerCase()}`,
      );
    }
    if (to === 'ACTIVE') {
      const [active] = await tx
        .select({ n: count() })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.organizationId, auth.organizationId),
            eq(productVariants.productId, product.id),
            eq(productVariants.status, 'ACTIVE'),
          ),
        );
      if ((active?.n ?? 0) === 0)
        throw new ConflictError('Add an active variant before activating this product');
    }
  }

  private async freeSlug(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    base: string,
  ): Promise<string> {
    for (const candidate of [base, withRandomSuffix(base), withRandomSuffix(base)]) {
      const [taken] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.organizationId, auth.organizationId), eq(products.slug, candidate)));
      if (!taken) return candidate;
    }
    throw new ConflictError('Could not find a free URL name, choose one explicitly');
  }
}
