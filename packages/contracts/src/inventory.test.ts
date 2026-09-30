import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_REASONS,
  MAX_RESERVATION_LINES,
  adjustStockRequestSchema,
  adjustmentIssue,
  inventoryLevelListQuerySchema,
  inventoryMovementListQuerySchema,
  reserveStockRequestSchema,
  transferStockRequestSchema,
  updateInventoryLevelRequestSchema,
} from './inventory.js';

const warehouseId = '0199a0b2-0000-7000-8000-000000000001';
const otherWarehouseId = '0199a0b2-0000-7000-8000-000000000002';
const variantId = '0199a0b2-0000-7000-8000-000000000003';

describe('adjustment rules', () => {
  it('gives every reason a direction', () => {
    expect(Object.keys(ADJUSTMENT_DIRECTIONS).sort()).toEqual([...ADJUSTMENT_REASONS].sort());
  });

  it.each([
    ['RECEIVED', 5],
    ['FOUND', 1],
    ['RETURNED', 2],
    ['DAMAGED', -1],
    ['LOST', -3],
    ['CORRECTION', 4],
    ['CORRECTION', -4],
  ] as const)('accepts %s with a change of %d', (reason, quantityChange) => {
    expect(adjustmentIssue({ reason, quantityChange })).toBeNull();
  });

  it.each([
    ['RECEIVED', -5, 'This reason can only add stock'],
    ['RETURNED', -1, 'This reason can only add stock'],
    ['DAMAGED', 2, 'This reason can only remove stock'],
    ['LOST', 1, 'This reason can only remove stock'],
    ['CORRECTION', 0, 'Enter a change other than zero'],
  ] as const)('rejects %s with a change of %d', (reason, quantityChange, message) => {
    expect(adjustmentIssue({ reason, quantityChange })).toEqual({
      path: 'quantityChange',
      message,
    });
  });

  it('a count states the counted quantity, never a change', () => {
    expect(adjustmentIssue({ reason: 'COUNT', countedQuantity: 0 })).toBeNull();
    expect(adjustmentIssue({ reason: 'COUNT' })?.path).toBe('countedQuantity');
    expect(adjustmentIssue({ reason: 'COUNT', countedQuantity: 3, quantityChange: 1 })?.path).toBe(
      'quantityChange',
    );
    expect(adjustmentIssue({ reason: 'RECEIVED', countedQuantity: 3 })?.path).toBe(
      'countedQuantity',
    );
  });

  it('the request schema applies the same rules and rejects fractions', () => {
    const base = { warehouseId, variantId };
    expect(
      adjustStockRequestSchema.safeParse({ ...base, reason: 'RECEIVED', quantityChange: 3 })
        .success,
    ).toBe(true);
    const wrongWay = adjustStockRequestSchema.safeParse({
      ...base,
      reason: 'RECEIVED',
      quantityChange: -3,
    });
    expect(wrongWay.error?.issues[0]?.path).toEqual(['quantityChange']);
    expect(
      adjustStockRequestSchema.safeParse({ ...base, reason: 'CORRECTION', quantityChange: 1.5 })
        .success,
    ).toBe(false);
  });
});

describe('transfers and reservations', () => {
  it('a transfer needs two different warehouses and a positive whole quantity', () => {
    const transfer = { fromWarehouseId: warehouseId, toWarehouseId: otherWarehouseId, variantId };
    expect(transferStockRequestSchema.safeParse({ ...transfer, quantity: 2 }).success).toBe(true);
    const same = transferStockRequestSchema.safeParse({
      ...transfer,
      toWarehouseId: warehouseId,
      quantity: 2,
    });
    expect(same.error?.issues[0]?.path).toEqual(['toWarehouseId']);
    for (const quantity of [0, -1, 1.5]) {
      expect(transferStockRequestSchema.safeParse({ ...transfer, quantity }).success).toBe(false);
    }
  });

  it('a reservation lists each warehouse and variant once, within the line limit', () => {
    const line = { warehouseId, variantId, quantity: 1 };
    expect(reserveStockRequestSchema.safeParse({ lines: [line], reference: 'Hold' }).success).toBe(
      true,
    );
    expect(
      reserveStockRequestSchema.safeParse({
        lines: [line, { ...line, quantity: 2 }],
        reference: 'x',
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: MAX_RESERVATION_LINES + 1 }, (_, i) => ({
      ...line,
      variantId: `0199a0b2-0000-7000-8000-${String(i).padStart(12, '0')}`,
    }));
    expect(reserveStockRequestSchema.safeParse({ lines: tooMany, reference: 'x' }).success).toBe(
      false,
    );
    expect(reserveStockRequestSchema.safeParse({ lines: [line], reference: '  ' }).success).toBe(
      false,
    );
  });

  it('a reorder point is a whole number or null', () => {
    expect(updateInventoryLevelRequestSchema.parse({ reorderPoint: null }).reorderPoint).toBeNull();
    expect(updateInventoryLevelRequestSchema.safeParse({ reorderPoint: -1 }).success).toBe(false);
  });
});

describe('inventory queries', () => {
  it('reads lowStock from the query string as a boolean', () => {
    expect(inventoryLevelListQuerySchema.parse({ lowStock: 'true' }).lowStock).toBe(true);
    expect(inventoryLevelListQuerySchema.parse({ lowStock: 'false' }).lowStock).toBe(false);
    expect(inventoryLevelListQuerySchema.parse({}).lowStock).toBeUndefined();
  });

  it('rejects a movement date range that ends before it starts', () => {
    const range = inventoryMovementListQuerySchema.safeParse({
      from: '2026-09-30',
      to: '2026-09-01',
    });
    expect(range.error?.issues[0]?.path).toEqual(['to']);
  });
});
