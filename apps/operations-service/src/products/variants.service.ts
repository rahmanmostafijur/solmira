import { Inject, Injectable } from '@nestjs/common';
import {
  canTransitionVariant,
  type CreateVariantRequest,
  type Page,
  type UpdateVariantRequest,
  type Variant,
  type VariantListQuery,
} from '@solmira/contracts';
import { ConflictError, type TenantAuthContext } from '@solmira/service-kit';
import { and, asc, count, eq, ne, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { contains, iso, offsetOf, orNotFound, pageOf, rethrowConflict } from '@solmira/service-kit';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { productVariants, products } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { PRODUCT_CONFLICTS } from './products.service.js';

type VariantRow = typeof productVariants.$inferSelect;

function toVariant(row: VariantRow, basePrice: number): Variant {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    name: row.name,
    barcode: row.barcode,
    attributes: row.attributes,
    price: row.priceMinor,
    effectivePrice: row.priceMinor ?? basePrice,
    cost: row.costMinor,
    weightGrams: row.weightGrams,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toColumns(input: Omit<UpdateVariantRequest, 'status'>) {
  const { price, cost, ...rest } = input;
  return {
    ...rest,
    ...(price !== undefined ? { priceMinor: price } : {}),
    ...(cost !== undefined ? { costMinor: cost } : {}),
  };
}

@Injectable()
export class VariantsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(
    auth: TenantAuthContext,
    productId: string,
    query: VariantListQuery,
  ): Promise<Page<Variant>> {
    return this.database.forTenant(auth, async (tx) => {
      const product = await this.product(tx, auth, productId);
      const where = and(
        eq(productVariants.organizationId, auth.organizationId),
        eq(productVariants.productId, productId),
        query.status ? eq(productVariants.status, query.status) : undefined,
        query.search
          ? or(
              contains(productVariants.sku, query.search),
              contains(productVariants.name, query.search),
              contains(productVariants.barcode, query.search),
            )
          : undefined,
      );
      const rows = await tx
        .select()
        .from(productVariants)
        .where(where)
        .orderBy(asc(productVariants.createdAt), asc(productVariants.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await tx.select({ n: count() }).from(productVariants).where(where);
      return pageOf(
        rows.map((row) => toVariant(row, product.basePriceMinor)),
        total?.n ?? 0,
        query,
      );
    });
  }

  async create(
    auth: TenantAuthContext,
    productId: string,
    input: CreateVariantRequest,
  ): Promise<Variant> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const product = await this.product(tx, auth, productId, true);
        if (product.status === 'ARCHIVED')
          throw new ConflictError('Restore the product before adding variants');
        const [row] = await tx
          .insert(productVariants)
          .values({
            id: uuidv7(),
            organizationId: auth.organizationId,
            productId,
            ...toColumns(input),
            sku: input.sku,
            name: input.name,
          })
          .returning();
        await recordEvent(tx, auth, 'variant.created', {
          productId,
          variantId: row!.id,
          sku: row!.sku,
        });
        return toVariant(row!, product.basePriceMinor);
      });
    } catch (error) {
      rethrowConflict(error, PRODUCT_CONFLICTS);
    }
  }

  async update(
    auth: TenantAuthContext,
    productId: string,
    variantId: string,
    input: UpdateVariantRequest,
  ): Promise<Variant> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const product = await this.product(tx, auth, productId, true);
        const [current] = await tx
          .select()
          .from(productVariants)
          .where(
            and(
              eq(productVariants.organizationId, auth.organizationId),
              eq(productVariants.productId, productId),
              eq(productVariants.id, variantId),
            ),
          )
          .for('update');
        orNotFound(current, 'Variant');
        const { status, ...fields } = input;
        if (status && status !== current!.status) {
          if (!canTransitionVariant(current!.status, status)) {
            throw new ConflictError(
              `An ${current!.status.toLowerCase()} variant cannot become ${status.toLowerCase()}`,
            );
          }
          if (product.status === 'ACTIVE' && current!.status === 'ACTIVE')
            await this.assertAnotherActive(tx, auth, productId, variantId);
        }
        const [row] = await tx
          .update(productVariants)
          .set({ ...toColumns(fields), ...(status ? { status } : {}), updatedAt: new Date() })
          .where(
            and(
              eq(productVariants.organizationId, auth.organizationId),
              eq(productVariants.id, variantId),
            ),
          )
          .returning();
        if (status && status !== current!.status) {
          await recordEvent(tx, auth, 'variant.status_changed', {
            productId,
            variantId,
            fromStatus: current!.status,
            toStatus: status,
          });
        }
        if (Object.keys(fields).length > 0) {
          await recordEvent(tx, auth, 'variant.updated', {
            productId,
            variantId,
            fields: Object.keys(fields),
          });
        }
        return toVariant(row!, product.basePriceMinor);
      });
    } catch (error) {
      rethrowConflict(error, PRODUCT_CONFLICTS);
    }
  }

  /** Variants are archived, not deleted, and archiving frees the SKU for reuse. Idempotent. */
  async archive(auth: TenantAuthContext, productId: string, variantId: string): Promise<void> {
    const variants = await this.database.forTenant(auth, (tx) =>
      tx
        .select({ status: productVariants.status })
        .from(productVariants)
        .where(
          and(
            eq(productVariants.organizationId, auth.organizationId),
            eq(productVariants.productId, productId),
            eq(productVariants.id, variantId),
          ),
        ),
    );
    const variant = orNotFound(variants[0], 'Variant');
    if (variant.status !== 'ARCHIVED')
      await this.update(auth, productId, variantId, { status: 'ARCHIVED' });
  }

  private async product(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    productId: string,
    lock = false,
  ) {
    const query = tx
      .select({ id: products.id, status: products.status, basePriceMinor: products.basePriceMinor })
      .from(products)
      .where(and(eq(products.organizationId, auth.organizationId), eq(products.id, productId)));
    const [row] = await (lock ? query.for('update') : query);
    return orNotFound(row, 'Product');
  }

  /** An active product must keep at least one active variant, or it has nothing to sell. */
  private async assertAnotherActive(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    productId: string,
    variantId: string,
  ) {
    const [others] = await tx
      .select({ n: count() })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.organizationId, auth.organizationId),
          eq(productVariants.productId, productId),
          eq(productVariants.status, 'ACTIVE'),
          ne(productVariants.id, variantId),
        ),
      );
    if ((others?.n ?? 0) === 0) {
      throw new ConflictError(
        'An active product needs at least one active variant. Deactivate the product first.',
      );
    }
  }
}
