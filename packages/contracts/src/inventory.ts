import { z } from 'zod';
import { paginationQuerySchema, searchTermSchema, sortDirectionSchema } from './pagination.js';

// ---- quantities ---------------------------------------------------------------------------------

/**
 * Stock is counted in whole units of a variant. The ceiling keeps every balance inside a
 * PostgreSQL `integer` with room to spare, so no arithmetic in the database can overflow.
 */
export const MAX_STOCK_QUANTITY = 1_000_000_000;
/** Largest quantity a single adjustment, transfer or reservation line may move. */
export const MAX_MOVEMENT_QUANTITY = 1_000_000;
export const MAX_RESERVATION_LINES = 50;

const quantitySchema = z
  .number()
  .int('Whole units only')
  .min(1, 'Quantity must be at least 1')
  .max(MAX_MOVEMENT_QUANTITY);
const optionalNote = z.string().trim().max(500).nullable().optional();
const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date());

// ---- movements ----------------------------------------------------------------------------------

/**
 * Every change to a stock level is one ledger row of one of these types. Shipments (phase 6) add
 * their own type when they land.
 */
export const INVENTORY_MOVEMENT_TYPES = [
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RESERVATION',
  'RELEASE',
  'PURCHASE_RECEIPT',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

/** Why stock was adjusted by hand. The reason decides which direction the change may go. */
export const ADJUSTMENT_REASONS = [
  'RECEIVED',
  'COUNT',
  'DAMAGED',
  'LOST',
  'FOUND',
  'RETURNED',
  'CORRECTION',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_DIRECTIONS: Readonly<
  Record<AdjustmentReason, 'increase' | 'decrease' | 'any'>
> = {
  RECEIVED: 'increase',
  FOUND: 'increase',
  RETURNED: 'increase',
  DAMAGED: 'decrease',
  LOST: 'decrease',
  COUNT: 'any',
  CORRECTION: 'any',
};

/**
 * The problem with an adjustment's shape, or null when it is valid. A count states the quantity
 * found on the shelf (`countedQuantity`); every other reason states the change (`quantityChange`),
 * whose sign must match the reason: stock is not "received" downwards.
 */
export function adjustmentIssue(input: {
  reason: AdjustmentReason;
  quantityChange?: number | undefined;
  countedQuantity?: number | undefined;
}): { path: 'quantityChange' | 'countedQuantity'; message: string } | null {
  if (input.reason === 'COUNT') {
    if (input.countedQuantity === undefined)
      return { path: 'countedQuantity', message: 'Enter the quantity counted' };
    if (input.quantityChange !== undefined)
      return { path: 'quantityChange', message: 'A count sets the quantity; omit the change' };
    return null;
  }
  if (input.countedQuantity !== undefined)
    return { path: 'countedQuantity', message: 'Only a stock count sets a counted quantity' };
  if (input.quantityChange === undefined || input.quantityChange === 0)
    return { path: 'quantityChange', message: 'Enter a change other than zero' };
  const direction = ADJUSTMENT_DIRECTIONS[input.reason];
  if (direction === 'increase' && input.quantityChange < 0)
    return { path: 'quantityChange', message: 'This reason can only add stock' };
  if (direction === 'decrease' && input.quantityChange > 0)
    return { path: 'quantityChange', message: 'This reason can only remove stock' };
  return null;
}

export const adjustStockRequestSchema = z
  .object({
    warehouseId: z.uuid(),
    variantId: z.uuid(),
    reason: z.enum(ADJUSTMENT_REASONS),
    /** Signed change in units: +5 adds five, -2 removes two. */
    quantityChange: z
      .number()
      .int('Whole units only')
      .min(-MAX_MOVEMENT_QUANTITY)
      .max(MAX_MOVEMENT_QUANTITY)
      .optional(),
    /** For a stock count: the quantity physically present. The change is computed under lock. */
    countedQuantity: z.number().int('Whole units only').min(0).max(MAX_STOCK_QUANTITY).optional(),
    note: optionalNote,
  })
  .superRefine((body, context) => {
    const issue = adjustmentIssue(body);
    if (issue) context.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
export type AdjustStockRequest = z.infer<typeof adjustStockRequestSchema>;

export const transferStockRequestSchema = z
  .object({
    fromWarehouseId: z.uuid(),
    toWarehouseId: z.uuid(),
    variantId: z.uuid(),
    quantity: quantitySchema,
    note: optionalNote,
  })
  .refine((body) => body.fromWarehouseId !== body.toWarehouseId, {
    path: ['toWarehouseId'],
    message: 'Choose a different destination warehouse',
  });
export type TransferStockRequest = z.infer<typeof transferStockRequestSchema>;

export const reservationLineSchema = z.object({
  warehouseId: z.uuid(),
  variantId: z.uuid(),
  quantity: quantitySchema,
});
export type ReservationLine = z.infer<typeof reservationLineSchema>;

export const reserveStockRequestSchema = z.object({
  lines: z
    .array(reservationLineSchema)
    .min(1, 'Add at least one line')
    .max(MAX_RESERVATION_LINES)
    .refine(
      (lines) => new Set(lines.map((l) => `${l.warehouseId}:${l.variantId}`)).size === lines.length,
      'Each warehouse and variant may appear only once',
    ),
  /** What the stock is held for, e.g. "Trade show sample set". Orders reserve in phase 6. */
  reference: z.string().trim().min(1, 'Say what the stock is held for').max(100),
  note: optionalNote,
});
export type ReserveStockRequest = z.infer<typeof reserveStockRequestSchema>;

export const updateInventoryLevelRequestSchema = z.object({
  /** Available quantity at or below which the level counts as low stock; null switches it off. */
  reorderPoint: z.number().int('Whole units only').min(0).max(MAX_STOCK_QUANTITY).nullable(),
});
export type UpdateInventoryLevelRequest = z.infer<typeof updateInventoryLevelRequestSchema>;

// ---- queries ------------------------------------------------------------------------------------

export const inventoryLevelListQuerySchema = paginationQuerySchema.extend({
  /** Matches SKU, variant name or product name. */
  search: searchTermSchema,
  warehouseId: z.uuid().optional(),
  productId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  lowStock: z.stringbool().optional(),
  sort: z.enum(['sku', 'onHand', 'available', 'updatedAt']).default('sku'),
  direction: sortDirectionSchema.default('asc'),
});
export type InventoryLevelListQuery = z.infer<typeof inventoryLevelListQuerySchema>;

export const inventoryMovementListQuerySchema = paginationQuerySchema
  .extend({
    warehouseId: z.uuid().optional(),
    variantId: z.uuid().optional(),
    type: z.enum(INVENTORY_MOVEMENT_TYPES).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || new Date(q.from) <= new Date(q.to), {
    path: ['to'],
    message: 'to must be after from',
  });
export type InventoryMovementListQuery = z.infer<typeof inventoryMovementListQuerySchema>;

export const RESERVATION_STATUSES = ['ACTIVE', 'RELEASED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const reservationListQuerySchema = paginationQuerySchema.extend({
  /** Matches the reservation reference. */
  search: searchTermSchema,
  status: z.enum(RESERVATION_STATUSES).optional(),
  warehouseId: z.uuid().optional(),
  variantId: z.uuid().optional(),
});
export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

// ---- responses ----------------------------------------------------------------------------------

export interface StockLocation {
  id: string;
  code: string;
  name: string;
}

export interface StockItem {
  variantId: string;
  sku: string;
  variantName: string;
  productId: string;
  productName: string;
}

export interface InventoryLevel {
  id: string;
  warehouse: StockLocation;
  item: StockItem;
  onHand: number;
  reserved: number;
  /** on hand minus reserved: what can still be promised. */
  available: number;
  reorderPoint: number | null;
  isLowStock: boolean;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  inventoryLevelId: string;
  type: InventoryMovementType;
  reason: AdjustmentReason | null;
  onHandChange: number;
  reservedChange: number;
  onHandAfter: number;
  reservedAfter: number;
  warehouse: StockLocation;
  item: StockItem;
  referenceType: 'TRANSFER' | 'RESERVATION' | 'PURCHASE_RECEIPT' | null;
  referenceId: string | null;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface StockReservation {
  id: string;
  inventoryLevelId: string;
  warehouse: StockLocation;
  item: StockItem;
  quantity: number;
  status: ReservationStatus;
  reference: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  releasedAt: string | null;
}

export interface StockTransferResult {
  transferId: string;
  from: InventoryLevel;
  to: InventoryLevel;
}
