import { ValidationError, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq } from 'drizzle-orm';
import type { OperationsTransaction } from '../database/database.module.js';
import { suppliers } from '../database/schema.js';

/**
 * Catalog rule for buying: purchase orders are placed with ACTIVE suppliers of the caller's
 * organization. Another organization's supplier is invisible under RLS and fails exactly like an
 * id that does not exist. Suppliers are never deleted, so history keeps pointing at them.
 */
export async function assertPurchasableSupplier(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  supplierId: string,
  field = 'supplierId',
): Promise<void> {
  const [supplier] = await tx
    .select({ status: suppliers.status })
    .from(suppliers)
    .where(and(eq(suppliers.organizationId, auth.organizationId), eq(suppliers.id, supplierId)));
  if (!supplier) throw new ValidationError([{ path: field, message: 'Supplier not found' }]);
  if (supplier.status !== 'ACTIVE')
    throw new ValidationError([{ path: field, message: 'Supplier is inactive' }]);
}
