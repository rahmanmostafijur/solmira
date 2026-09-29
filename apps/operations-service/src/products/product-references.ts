import type { TenantAuthContext } from '@solmira/service-kit';
import { and, eq } from 'drizzle-orm';
import { referenceError } from '../common/query.js';
import type { OperationsTransaction } from '../database/database.module.js';
import { categories, suppliers } from '../database/schema.js';

/**
 * A product may only reference an ACTIVE category and supplier of the same organization. Another
 * organization's id is invisible under RLS, so it fails exactly like a non-existent id (and the
 * composite foreign keys would reject it anyway).
 */
export async function assertProductReferences(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  references: { categoryId?: string | null; supplierId?: string | null },
): Promise<void> {
  if (references.categoryId) {
    const [category] = await tx
      .select({ status: categories.status })
      .from(categories)
      .where(
        and(
          eq(categories.organizationId, auth.organizationId),
          eq(categories.id, references.categoryId),
        ),
      );
    if (!category || category.status !== 'ACTIVE') throw referenceError('categoryId', 'Category');
  }
  if (references.supplierId) {
    const [supplier] = await tx
      .select({ status: suppliers.status })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.organizationId, auth.organizationId),
          eq(suppliers.id, references.supplierId),
        ),
      );
    if (!supplier || supplier.status !== 'ACTIVE') throw referenceError('supplierId', 'Supplier');
  }
}
