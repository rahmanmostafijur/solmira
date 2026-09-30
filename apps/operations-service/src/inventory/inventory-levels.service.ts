import { Inject, Injectable } from '@nestjs/common';
import type {
  InventoryLevel,
  InventoryLevelListQuery,
  InventoryMovement,
  InventoryMovementListQuery,
  Page,
  UpdateInventoryLevelRequest,
} from '@solmira/contracts';
import type { TenantAuthContext } from '@solmira/service-kit';
import { and, asc, desc, eq, gte, lt, not, or, sql } from 'drizzle-orm';
import { contains, offsetOf, orNotFound, pageOf } from '../common/query.js';
import { Database } from '../database/database.module.js';
import {
  inventoryLevels,
  inventoryMovements,
  productVariants,
  products,
} from '../database/schema.js';
import {
  levelCount,
  levelRows,
  loadLevel,
  movementCount,
  movementRows,
  toLevel,
  toMovement,
} from './inventory-views.js';
import { recordLowStockCrossing } from './stock-ledger.js';

const SORT_COLUMNS = {
  sku: productVariants.sku,
  onHand: inventoryLevels.onHand,
  available: inventoryLevels.available,
  updatedAt: inventoryLevels.updatedAt,
} as const;

const lowStock = sql`${inventoryLevels.reorderPoint} is not null and ${inventoryLevels.available} <= ${inventoryLevels.reorderPoint}`;

/** Dates without a time mean the whole day: `to=2026-09-30` includes that day. */
function endOf(value: string): Date {
  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(date.getTime() + 86_400_000) : date;
}

@Injectable()
export class InventoryLevelsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  list(auth: TenantAuthContext, query: InventoryLevelListQuery): Promise<Page<InventoryLevel>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(inventoryLevels.organizationId, auth.organizationId),
        query.warehouseId ? eq(inventoryLevels.warehouseId, query.warehouseId) : undefined,
        query.variantId ? eq(inventoryLevels.variantId, query.variantId) : undefined,
        query.productId ? eq(productVariants.productId, query.productId) : undefined,
        query.lowStock === undefined ? undefined : query.lowStock ? lowStock : not(lowStock),
        query.search
          ? or(
              contains(productVariants.sku, query.search),
              contains(productVariants.name, query.search),
              contains(products.name, query.search),
            )
          : undefined,
      );
      const sortColumn = SORT_COLUMNS[query.sort];
      const rows = await levelRows(tx)
        .where(where)
        .orderBy(
          query.direction === 'asc' ? asc(sortColumn) : desc(sortColumn),
          asc(inventoryLevels.id),
        )
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await levelCount(tx).where(where);
      return pageOf(rows.map(toLevel), Number(total?.n ?? 0), query);
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<InventoryLevel> {
    return this.database.forTenant(auth, async (tx) =>
      orNotFound(await loadLevel(tx, auth.organizationId, id), 'Inventory level'),
    );
  }

  /** Setting a reorder point is configuration, not a stock change: no ledger row. */
  updateReorderPoint(
    auth: TenantAuthContext,
    id: string,
    input: UpdateInventoryLevelRequest,
  ): Promise<InventoryLevel> {
    return this.database.forTenant(auth, async (tx) => {
      const [before] = await tx
        .select({ reorderPoint: inventoryLevels.reorderPoint })
        .from(inventoryLevels)
        .where(
          and(eq(inventoryLevels.organizationId, auth.organizationId), eq(inventoryLevels.id, id)),
        )
        .for('update');
      orNotFound(before, 'Inventory level');
      const [row] = await tx
        .update(inventoryLevels)
        .set({ reorderPoint: input.reorderPoint, updatedAt: new Date() })
        .where(
          and(eq(inventoryLevels.organizationId, auth.organizationId), eq(inventoryLevels.id, id)),
        )
        .returning();
      await recordLowStockCrossing(tx, auth, row!, row!.available ?? 0, before!.reorderPoint);
      return orNotFound(await loadLevel(tx, auth.organizationId, id), 'Inventory level');
    });
  }

  /** The ledger, newest first. */
  movements(
    auth: TenantAuthContext,
    query: InventoryMovementListQuery,
  ): Promise<Page<InventoryMovement>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(inventoryMovements.organizationId, auth.organizationId),
        query.warehouseId ? eq(inventoryLevels.warehouseId, query.warehouseId) : undefined,
        query.variantId ? eq(inventoryLevels.variantId, query.variantId) : undefined,
        query.type ? eq(inventoryMovements.type, query.type) : undefined,
        query.from ? gte(inventoryMovements.createdAt, new Date(query.from)) : undefined,
        query.to ? lt(inventoryMovements.createdAt, endOf(query.to)) : undefined,
      );
      const rows = await movementRows(tx)
        .where(where)
        .orderBy(desc(inventoryMovements.sequence))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await movementCount(tx).where(where);
      return pageOf(rows.map(toMovement), Number(total?.n ?? 0), query);
    });
  }
}
