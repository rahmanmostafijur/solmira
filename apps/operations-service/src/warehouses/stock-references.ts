import { ValidationError, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq } from 'drizzle-orm';
import type { OperationsTransaction } from '../database/database.module.js';
import { productVariants, products, warehouses } from '../database/schema.js';

/**
 * Catalog rules for holding stock, owned by the catalog and used by inventory, so inventory never
 * interprets catalog statuses itself. Stock may only be added to or held in an ACTIVE warehouse,
 * for an ACTIVE variant of a product that is not archived. Taking stock out is always allowed, so
 * a warehouse can be emptied after it is deactivated. Another organization's id is invisible
 * under RLS and fails exactly like an id that does not exist.
 */
export async function assertStockableWarehouse(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  warehouseId: string,
  field: string,
): Promise<void> {
  const [warehouse] = await tx
    .select({ status: warehouses.status })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.organizationId), eq(warehouses.id, warehouseId)));
  if (!warehouse) throw fieldError(field, 'Warehouse not found');
  if (warehouse.status !== 'ACTIVE') throw fieldError(field, 'Warehouse is inactive');
}

export async function assertStockableVariant(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  variantId: string,
  field: string,
): Promise<void> {
  const [variant] = await tx
    .select({ status: productVariants.status, productStatus: products.status })
    .from(productVariants)
    .innerJoin(
      products,
      and(
        eq(products.organizationId, productVariants.organizationId),
        eq(products.id, productVariants.productId),
      ),
    )
    .where(
      and(
        eq(productVariants.organizationId, auth.organizationId),
        eq(productVariants.id, variantId),
      ),
    );
  if (!variant) throw fieldError(field, 'Variant not found');
  if (variant.status !== 'ACTIVE' || variant.productStatus === 'ARCHIVED')
    throw fieldError(field, 'Variant is not active');
}

/** Existence only, for movements that take stock out (any status is fine for those). */
export async function assertWarehouseExists(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  warehouseId: string,
  field: string,
): Promise<void> {
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.organizationId), eq(warehouses.id, warehouseId)));
  if (!warehouse) throw fieldError(field, 'Warehouse not found');
}

export async function assertVariantExists(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  variantId: string,
  field: string,
): Promise<void> {
  const [variant] = await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      and(
        eq(productVariants.organizationId, auth.organizationId),
        eq(productVariants.id, variantId),
      ),
    );
  if (!variant) throw fieldError(field, 'Variant not found');
}

const fieldError = (path: string, message: string) => new ValidationError([{ path, message }]);
