import {
  MAX_STOCK_QUANTITY,
  type AdjustmentReason,
  type InventoryMovementType,
} from '@solmira/contracts';
import { getRequestContext, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { OperationsTransaction } from '../database/database.module.js';
import { inventoryLevels, inventoryMovements } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';

export type LevelRow = typeof inventoryLevels.$inferSelect;

export interface StockChange {
  readonly levelId: string;
  readonly type: InventoryMovementType;
  readonly onHandChange: number;
  readonly reservedChange: number;
  readonly reason?: AdjustmentReason | null;
  readonly referenceType?: 'TRANSFER' | 'RESERVATION' | 'PURCHASE_RECEIPT' | null;
  readonly referenceId?: string | null;
  readonly note?: string | null;
  /** Lets a caller that must reference the ledger row (a receipt line) choose its id. */
  readonly movementId?: string;
}

const levelOf = (auth: TenantAuthContext, levelId: string) =>
  and(eq(inventoryLevels.organizationId, auth.organizationId), eq(inventoryLevels.id, levelId));

/**
 * The one lock order for changes that touch several levels: ascending level id, compared as plain
 * strings. Deliberately not localeCompare, whose result depends on the runtime's collation data;
 * two service instances must always agree on the order or the deadlock protection is gone.
 */
export const byLevelId = (a: { levelId: string }, b: { levelId: string }): number =>
  a.levelId < b.levelId ? -1 : a.levelId > b.levelId ? 1 : 0;

export const isLowStock = (row: Pick<LevelRow, 'available' | 'reorderPoint'>): boolean =>
  row.reorderPoint !== null && (row.available ?? 0) <= row.reorderPoint;

/**
 * The only way stock changes. One guarded UPDATE moves the counters, and PostgreSQL row locking
 * serializes concurrent writers on the same level: a second writer waits, then re-evaluates the
 * guard against the committed balance. So "enough available" is checked and consumed atomically,
 * with no read-then-write gap to oversell through.
 *
 * Returns the updated level, or null when the guard failed: not enough stock for a decrease, the
 * stock ceiling (MAX_STOCK_QUANTITY) for an increase, or no such level.
 * Callers that change several levels must call this in a deterministic order (by level id) so two
 * transactions can never wait on each other's rows.
 */
export async function applyStockChange(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  change: StockChange,
): Promise<LevelRow | null> {
  const { onHandChange, reservedChange } = change;
  const [row] = await tx
    .update(inventoryLevels)
    .set({
      onHand: sql`${inventoryLevels.onHand} + ${onHandChange}`,
      reserved: sql`${inventoryLevels.reserved} + ${reservedChange}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        levelOf(auth, change.levelId),
        // Keeps reserved <= on_hand and reserved >= 0 (which together imply on_hand >= 0).
        sql`${inventoryLevels.onHand} + ${onHandChange} >= ${inventoryLevels.reserved} + ${reservedChange}`,
        sql`${inventoryLevels.reserved} + ${reservedChange} >= 0`,
        sql`${inventoryLevels.onHand} + ${onHandChange} <= ${MAX_STOCK_QUANTITY}`,
      ),
    )
    .returning();
  if (!row) return null;

  await tx.insert(inventoryMovements).values({
    id: change.movementId ?? uuidv7(),
    organizationId: auth.organizationId,
    inventoryLevelId: row.id,
    type: change.type,
    reason: change.reason ?? null,
    onHandChange,
    reservedChange,
    onHandAfter: row.onHand,
    reservedAfter: row.reserved,
    referenceType: change.referenceType ?? null,
    referenceId: change.referenceId ?? null,
    note: change.note ?? null,
    actorId: auth.userId,
    correlationId: getRequestContext()?.correlationId ?? uuidv7(),
  });

  const availableBefore = (row.available ?? 0) - (onHandChange - reservedChange);
  await recordLowStockCrossing(tx, auth, row, availableBefore);
  return row;
}

/** Emits inventory.low_stock when a level moves from above its reorder point to at or below it. */
export async function recordLowStockCrossing(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  row: LevelRow,
  availableBefore: number,
  reorderPointBefore: number | null = row.reorderPoint,
): Promise<void> {
  const wasLow = reorderPointBefore !== null && availableBefore <= reorderPointBefore;
  if (wasLow || !isLowStock(row)) return;
  await recordEvent(tx, auth, 'inventory.low_stock', {
    inventoryLevelId: row.id,
    warehouseId: row.warehouseId,
    variantId: row.variantId,
    available: row.available ?? 0,
    reorderPoint: row.reorderPoint!,
  });
}

export async function findLevel(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  warehouseId: string,
  variantId: string,
  options: { lock?: boolean } = {},
): Promise<LevelRow | undefined> {
  const query = tx
    .select()
    .from(inventoryLevels)
    .where(
      and(
        eq(inventoryLevels.organizationId, auth.organizationId),
        eq(inventoryLevels.warehouseId, warehouseId),
        eq(inventoryLevels.variantId, variantId),
      ),
    );
  const [row] = await (options.lock ? query.for('update') : query);
  return row;
}

/**
 * The level for a warehouse and variant, created empty if it does not exist yet. Safe under
 * concurrency: two first receipts race on the unique key, one inserts, both then use that row.
 */
export async function ensureLevel(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  warehouseId: string,
  variantId: string,
): Promise<LevelRow> {
  await tx
    .insert(inventoryLevels)
    .values({ id: uuidv7(), organizationId: auth.organizationId, warehouseId, variantId })
    .onConflictDoNothing({
      target: [
        inventoryLevels.organizationId,
        inventoryLevels.warehouseId,
        inventoryLevels.variantId,
      ],
    });
  const row = await findLevel(tx, auth, warehouseId, variantId);
  if (!row) throw new Error('Inventory level missing right after upsert');
  return row;
}

export async function currentLevel(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  levelId: string,
): Promise<LevelRow | undefined> {
  const [row] = await tx.select().from(inventoryLevels).where(levelOf(auth, levelId));
  return row;
}
