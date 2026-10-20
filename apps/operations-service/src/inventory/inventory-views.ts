import type {
  InventoryLevel,
  InventoryMovement,
  StockItem,
  StockLocation,
  StockReservation,
} from '@solmira/contracts';
import { and, count, eq } from 'drizzle-orm';
import { iso } from '@solmira/service-kit';
import type { OperationsTransaction } from '../database/database.module.js';
import {
  inventoryLevels,
  inventoryMovements,
  inventoryReservations,
  productVariants,
  products,
  warehouses,
} from '../database/schema.js';
import { isLowStock, type LevelRow } from './stock-ledger.js';

/**
 * Display joins for inventory responses. Inventory reads catalog tables here only to label rows
 * (code, SKU, names); every rule about catalog data lives in the catalog (stock-references.ts).
 */
const locationColumns = { id: warehouses.id, code: warehouses.code, name: warehouses.name };
const itemColumns = {
  variantId: productVariants.id,
  sku: productVariants.sku,
  variantName: productVariants.name,
  productId: products.id,
  productName: products.name,
};

type Labels = { warehouse: StockLocation; item: StockItem };

/** Selected alongside a level, movement or reservation to label it. */
export const LABELS = { warehouse: locationColumns, item: itemColumns };

// Join conditions: every join also matches organization_id, like the composite foreign keys.
const onWarehouse = and(
  eq(warehouses.organizationId, inventoryLevels.organizationId),
  eq(warehouses.id, inventoryLevels.warehouseId),
);
const onVariant = and(
  eq(productVariants.organizationId, inventoryLevels.organizationId),
  eq(productVariants.id, inventoryLevels.variantId),
);
const onProduct = and(
  eq(products.organizationId, productVariants.organizationId),
  eq(products.id, productVariants.productId),
);
const onMovementLevel = and(
  eq(inventoryLevels.organizationId, inventoryMovements.organizationId),
  eq(inventoryLevels.id, inventoryMovements.inventoryLevelId),
);
const onReservationLevel = and(
  eq(inventoryLevels.organizationId, inventoryReservations.organizationId),
  eq(inventoryLevels.id, inventoryReservations.inventoryLevelId),
);

/** Levels with their warehouse, variant and product labels. */
export const levelRows = (tx: OperationsTransaction) =>
  tx
    .select({ level: inventoryLevels, ...LABELS })
    .from(inventoryLevels)
    .innerJoin(warehouses, onWarehouse)
    .innerJoin(productVariants, onVariant)
    .innerJoin(products, onProduct);

export const levelCount = (tx: OperationsTransaction) =>
  tx
    .select({ n: count() })
    .from(inventoryLevels)
    .innerJoin(warehouses, onWarehouse)
    .innerJoin(productVariants, onVariant)
    .innerJoin(products, onProduct);

export const movementRows = (tx: OperationsTransaction) =>
  tx
    .select({ movement: inventoryMovements, ...LABELS })
    .from(inventoryMovements)
    .innerJoin(inventoryLevels, onMovementLevel)
    .innerJoin(warehouses, onWarehouse)
    .innerJoin(productVariants, onVariant)
    .innerJoin(products, onProduct);

/** Movement filters only touch the movement and its level, so the count needs no labels. */
export const movementCount = (tx: OperationsTransaction) =>
  tx.select({ n: count() }).from(inventoryMovements).innerJoin(inventoryLevels, onMovementLevel);

export const reservationRows = (tx: OperationsTransaction) =>
  tx
    .select({ reservation: inventoryReservations, ...LABELS })
    .from(inventoryReservations)
    .innerJoin(inventoryLevels, onReservationLevel)
    .innerJoin(warehouses, onWarehouse)
    .innerJoin(productVariants, onVariant)
    .innerJoin(products, onProduct);

export const reservationCount = (tx: OperationsTransaction) =>
  tx
    .select({ n: count() })
    .from(inventoryReservations)
    .innerJoin(inventoryLevels, onReservationLevel);

export function toLevel(row: { level: LevelRow } & Labels): InventoryLevel {
  const { level } = row;
  return {
    id: level.id,
    warehouse: row.warehouse,
    item: row.item,
    onHand: level.onHand,
    reserved: level.reserved,
    available: level.available ?? level.onHand - level.reserved,
    reorderPoint: level.reorderPoint,
    isLowStock: isLowStock(level),
    updatedAt: iso(level.updatedAt),
  };
}

export function toMovement(
  row: { movement: typeof inventoryMovements.$inferSelect } & Labels,
): InventoryMovement {
  const { movement } = row;
  return {
    id: movement.id,
    inventoryLevelId: movement.inventoryLevelId,
    type: movement.type,
    reason: movement.reason,
    onHandChange: movement.onHandChange,
    reservedChange: movement.reservedChange,
    onHandAfter: movement.onHandAfter,
    reservedAfter: movement.reservedAfter,
    warehouse: row.warehouse,
    item: row.item,
    referenceType: movement.referenceType,
    referenceId: movement.referenceId,
    note: movement.note,
    actorId: movement.actorId,
    createdAt: iso(movement.createdAt),
  };
}

export function toReservation(
  row: { reservation: typeof inventoryReservations.$inferSelect } & Labels,
): StockReservation {
  const { reservation } = row;
  return {
    id: reservation.id,
    inventoryLevelId: reservation.inventoryLevelId,
    warehouse: row.warehouse,
    item: row.item,
    quantity: reservation.quantity,
    status: reservation.status,
    reference: reservation.reference,
    note: reservation.note,
    createdBy: reservation.createdBy,
    createdAt: iso(reservation.createdAt),
    releasedAt: reservation.releasedAt ? iso(reservation.releasedAt) : null,
  };
}

/** One level with its labels, or undefined if it is not in this organization. */
export async function loadLevel(
  tx: OperationsTransaction,
  organizationId: string,
  levelId: string,
): Promise<InventoryLevel | undefined> {
  const [row] = await levelRows(tx).where(
    and(eq(inventoryLevels.organizationId, organizationId), eq(inventoryLevels.id, levelId)),
  );
  return row ? toLevel(row) : undefined;
}
