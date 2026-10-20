import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_IMAGES_PER_PRODUCT,
  type ImageContentType,
  type ProductImage,
} from '@solmira/contracts';
import {
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { iso, orNotFound } from '@solmira/service-kit';
import type { OperationsConfig } from '../config.js';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { productImages, products } from '../database/schema.js';
import { OBJECT_STORAGE, OPERATIONS_CONFIG } from '../operations.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import {
  productImageKey,
  validateImageUpload,
  type UploadedFile,
} from '../storage/image-validation.js';

type ImageRow = typeof productImages.$inferSelect;

/**
 * Metadata lives in PostgreSQL (tenant-scoped, RLS); bytes live in a private bucket. Clients never
 * see or choose an object key: they get short-lived signed URLs, issued only for images their
 * organization can see, so a guessed key is useless without a signature.
 */
@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(OPERATIONS_CONFIG) private readonly config: OperationsConfig,
  ) {}

  async list(auth: TenantAuthContext, productId: string): Promise<ProductImage[]> {
    const rows = await this.database.forTenant(auth, async (tx) => {
      await this.product(tx, auth, productId);
      return tx
        .select()
        .from(productImages)
        .where(
          and(
            eq(productImages.organizationId, auth.organizationId),
            eq(productImages.productId, productId),
          ),
        )
        .orderBy(asc(productImages.sortOrder), asc(productImages.id));
    });
    return Promise.all(rows.map((row) => this.toImage(row)));
  }

  async upload(
    auth: TenantAuthContext,
    productId: string,
    file: UploadedFile | undefined,
    altText?: string,
  ): Promise<ProductImage> {
    const image = validateImageUpload(file);
    const id = uuidv7();
    const key = productImageKey(auth.organizationId, productId, id);
    let stored = false;
    try {
      const row = await this.database.forTenant(auth, async (tx) => {
        const product = await this.product(tx, auth, productId, true);
        if (product.status === 'ARCHIVED')
          throw new ConflictError('Restore the product before adding images');
        const [existing] = await tx
          .select({ n: count(), maxOrder: sql<number | null>`max(${productImages.sortOrder})` })
          .from(productImages)
          .where(
            and(
              eq(productImages.organizationId, auth.organizationId),
              eq(productImages.productId, productId),
            ),
          );
        if ((existing?.n ?? 0) >= MAX_IMAGES_PER_PRODUCT) {
          throw new ConflictError(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
        }
        await this.storageCall(() => this.storage.put(key, image.body, image.contentType));
        stored = true;
        const [inserted] = await tx
          .insert(productImages)
          .values({
            id,
            organizationId: auth.organizationId,
            productId,
            objectKey: key,
            originalFilename: image.originalFilename,
            contentType: image.contentType,
            fileSize: image.body.length,
            sortOrder: (existing?.maxOrder ?? -1) + 1,
            altText: altText || null,
          })
          .returning();
        await recordEvent(tx, auth, 'product_image.added', { productId, imageId: id });
        return inserted!;
      });
      return this.toImage(row);
    } catch (error) {
      // The object was written but the metadata was not: remove it so no orphan remains.
      if (stored) await this.bestEffortDelete(key);
      throw error;
    }
  }

  async updateAltText(
    auth: TenantAuthContext,
    productId: string,
    imageId: string,
    altText: string | null,
  ): Promise<ProductImage> {
    const row = await this.database.forTenant(auth, async (tx) => {
      const [updated] = await tx
        .update(productImages)
        .set({ altText })
        .where(
          and(
            eq(productImages.organizationId, auth.organizationId),
            eq(productImages.productId, productId),
            eq(productImages.id, imageId),
          ),
        )
        .returning();
      return orNotFound(updated, 'Image');
    });
    return this.toImage(row);
  }

  /** The first image is the primary one; reordering must name every image of the product once. */
  async reorder(
    auth: TenantAuthContext,
    productId: string,
    imageIds: string[],
  ): Promise<ProductImage[]> {
    await this.database.forTenant(auth, async (tx) => {
      await this.product(tx, auth, productId, true);
      const rows = await tx
        .select({ id: productImages.id })
        .from(productImages)
        .where(
          and(
            eq(productImages.organizationId, auth.organizationId),
            eq(productImages.productId, productId),
          ),
        );
      const current = new Set(rows.map((row) => row.id));
      if (current.size !== imageIds.length || !imageIds.every((id) => current.has(id))) {
        throw new ValidationError([
          { path: 'imageIds', message: 'List every image of this product exactly once' },
        ]);
      }
      for (const [index, id] of imageIds.entries()) {
        await tx
          .update(productImages)
          .set({ sortOrder: index })
          .where(
            and(eq(productImages.organizationId, auth.organizationId), eq(productImages.id, id)),
          );
      }
    });
    return this.list(auth, productId);
  }

  async delete(auth: TenantAuthContext, productId: string, imageId: string): Promise<void> {
    const key = await this.database.forTenant(auth, async (tx) => {
      await this.product(tx, auth, productId, true);
      const [deleted] = await tx
        .delete(productImages)
        .where(
          and(
            eq(productImages.organizationId, auth.organizationId),
            eq(productImages.productId, productId),
            eq(productImages.id, imageId),
          ),
        )
        .returning({ objectKey: productImages.objectKey });
      const found = orNotFound(deleted, 'Image');
      // Close the gap so the positions stay 0..n-1 and the next image becomes primary.
      await tx.execute(sql`
        update ${productImages} set sort_order = ranked.position
        from (
          select id, row_number() over (order by sort_order, id) - 1 as position
          from ${productImages}
          where organization_id = ${auth.organizationId} and product_id = ${productId}
        ) ranked
        where ${productImages.id} = ranked.id
          and ${productImages.organizationId} = ${auth.organizationId}
          and ${productImages.sortOrder} <> ranked.position`);
      await recordEvent(tx, auth, 'product_image.removed', { productId, imageId });
      return found.objectKey;
    });
    // After commit: a failed object delete leaves an unreferenced object (swept later), never a
    // row pointing at a missing file.
    await this.bestEffortDelete(key);
  }

  private async product(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    productId: string,
    lock = false,
  ) {
    const query = tx
      .select({ id: products.id, status: products.status })
      .from(products)
      .where(and(eq(products.organizationId, auth.organizationId), eq(products.id, productId)));
    const [row] = await (lock ? query.for('update') : query);
    return orNotFound(row, 'Product');
  }

  private async toImage(row: ImageRow): Promise<ProductImage> {
    const ttl = this.config.IMAGE_URL_TTL_SECONDS;
    return {
      id: row.id,
      url: await this.storageCall(() => this.storage.signedReadUrl(row.objectKey, ttl)),
      urlExpiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      originalFilename: row.originalFilename,
      contentType: row.contentType as ImageContentType,
      fileSize: row.fileSize,
      sortOrder: row.sortOrder,
      altText: row.altText,
      isPrimary: row.sortOrder === 0,
      createdAt: iso(row.createdAt),
    };
  }

  /** Storage failures surface as 503 with a safe message; the cause is logged server-side. */
  private async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error({ err: error }, 'Object storage operation failed');
      throw new ServiceUnavailableError('Image storage is temporarily unavailable');
    }
  }

  private async bestEffortDelete(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not delete a stored image object');
    }
  }
}
