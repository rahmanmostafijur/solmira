import type { TenantAuthContext } from '@solmira/service-kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { OperationsTransaction } from '../database/database.module.js';
import { productVariants, products } from '../database/schema.js';

export interface PurchasableVariant {
  readonly variantId: string;
  readonly productId: string;
  /** Null when the variant can be bought; otherwise why it cannot. */
  readonly problem: 'Variant not found' | 'Variant is not active' | null;
}

/**
 * Catalog rule for buying and receiving: only an ACTIVE variant of a product that is not archived
 * (the same rule as adding stock, ADR-0019). Resolves any number of variants in one query and
 * derives each product id from the catalog, so a client can never pair a variant with the wrong
 * product. Unknown and other-tenant ids come back as "not found".
 */
export async function resolvePurchasableVariants(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  variantIds: readonly string[],
): Promise<Map<string, PurchasableVariant>> {
  const unique = [...new Set(variantIds)];
  const rows =
    unique.length === 0
      ? []
      : await tx
          .select({
            variantId: productVariants.id,
            productId: productVariants.productId,
            status: productVariants.status,
            productStatus: products.status,
          })
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
              inArray(productVariants.id, unique),
            ),
          );
  const found = new Map(rows.map((row) => [row.variantId, row]));
  return new Map(
    unique.map((variantId) => {
      const row = found.get(variantId);
      const problem = !row
        ? ('Variant not found' as const)
        : row.status !== 'ACTIVE' || row.productStatus === 'ARCHIVED'
          ? ('Variant is not active' as const)
          : null;
      return [variantId, { variantId, productId: row?.productId ?? '', problem }];
    }),
  );
}
