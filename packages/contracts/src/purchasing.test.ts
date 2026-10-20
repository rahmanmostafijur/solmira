import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_AMOUNT_MINOR,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  canApproveOwnOrder,
  canTransitionPurchaseOrder,
  createPurchaseOrderRequestSchema,
  formatPurchaseOrderNumber,
  isPurchaseOrderEditable,
  isPurchaseOrderOpen,
  isPurchaseOrderReceivable,
  lineAmounts,
  orderTotals,
  purchaseOrderLineSchema,
  receivePurchaseOrderRequestSchema,
  statusAfterReceipt,
  updatePurchaseOrderRequestSchema,
} from './purchasing.js';

const id = (n: number) => `0199a0b2-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('purchase order state machine', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS).sort()).toEqual(
      [...PURCHASE_ORDER_STATUSES].sort(),
    );
  });

  it.each([
    ['DRAFT', 'SUBMITTED'],
    ['DRAFT', 'CANCELLED'],
    ['SUBMITTED', 'APPROVED'],
    ['SUBMITTED', 'CANCELLED'],
    ['APPROVED', 'PARTIALLY_RECEIVED'],
    ['APPROVED', 'RECEIVED'],
    ['APPROVED', 'CANCELLED'],
    ['PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED'],
    ['PARTIALLY_RECEIVED', 'RECEIVED'],
    ['PARTIALLY_RECEIVED', 'CANCELLED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransitionPurchaseOrder(from, to)).toBe(true);
  });

  it.each([
    ['DRAFT', 'APPROVED'],
    ['DRAFT', 'RECEIVED'],
    ['SUBMITTED', 'DRAFT'],
    ['SUBMITTED', 'RECEIVED'],
    ['APPROVED', 'SUBMITTED'],
    ['RECEIVED', 'CANCELLED'],
    ['RECEIVED', 'PARTIALLY_RECEIVED'],
    ['CANCELLED', 'DRAFT'],
    ['CANCELLED', 'APPROVED'],
  ] as const)('refuses %s → %s', (from, to) => {
    expect(canTransitionPurchaseOrder(from, to)).toBe(false);
  });

  it('classifies statuses for editing and receiving', () => {
    expect(PURCHASE_ORDER_STATUSES.filter(isPurchaseOrderEditable)).toEqual(['DRAFT']);
    expect(PURCHASE_ORDER_STATUSES.filter(isPurchaseOrderReceivable)).toEqual([
      'APPROVED',
      'PARTIALLY_RECEIVED',
    ]);
    expect(PURCHASE_ORDER_STATUSES.filter((s) => !isPurchaseOrderOpen(s))).toEqual([
      'RECEIVED',
      'CANCELLED',
    ]);
  });

  it('derives the status after a receipt from every line', () => {
    expect(statusAfterReceipt([{ orderedQuantity: 100, receivedQuantity: 40 }])).toBe(
      'PARTIALLY_RECEIVED',
    );
    expect(
      statusAfterReceipt([
        { orderedQuantity: 100, receivedQuantity: 100 },
        { orderedQuantity: 5, receivedQuantity: 0 },
      ]),
    ).toBe('PARTIALLY_RECEIVED');
    expect(
      statusAfterReceipt([
        { orderedQuantity: 100, receivedQuantity: 100 },
        { orderedQuantity: 5, receivedQuantity: 5 },
      ]),
    ).toBe('RECEIVED');
  });

  it('keeps approval separate from creation and submission', () => {
    const order = { createdBy: 'creator', submittedBy: 'submitter' };
    expect(canApproveOwnOrder('creator', order)).toBe(false);
    expect(canApproveOwnOrder('submitter', order)).toBe(false);
    expect(canApproveOwnOrder('someone-else', order)).toBe(true);
  });
});

describe('money', () => {
  it('multiplies exactly and rounds tax half-up to the minor unit', () => {
    expect(lineAmounts(10, 1250, 1500)).toEqual({ subtotal: 12_500, tax: 1_875, total: 14_375 });
    // 999 × 7.5% = 74.925 → 75; 999 × 7.45% = 74.4255 → 74.
    expect(lineAmounts(3, 333, 750).tax).toBe(75);
    expect(lineAmounts(3, 333, 745).tax).toBe(74);
    // Exactly half a minor unit rounds up: 10 × 5% = 0.5 → 1.
    expect(lineAmounts(1, 10, 500).tax).toBe(1);
    expect(lineAmounts(5, 0, 1500)).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });

  it('stays exact at the largest allowed values', () => {
    const { total } = lineAmounts(1_000_000, 1_000_000, 0);
    expect(total).toBe(1_000_000_000_000);
    expect(Number.isSafeInteger(total)).toBe(true);
  });

  it('reports an amount past exact-integer range as too large instead of rounding it', () => {
    expect(lineAmounts(999_999, 9_999_999_999, 0).total).toBe(Infinity);
  });

  it('adds lines and shipping without floating point', () => {
    const lines = [lineAmounts(3, 10, 0), lineAmounts(7, 10, 0), lineAmounts(1, 1, 1000)];
    expect(orderTotals(lines, 250)).toEqual({
      subtotal: 101,
      tax: 0,
      shippingCost: 250,
      total: 351,
    });
    expect(orderTotals([], 0).total).toBe(0);
  });

  it('rejects fractional money, rates and quantities, and oversized lines', () => {
    const line = { variantId: id(1), quantity: 2, unitCost: 100 };
    expect(purchaseOrderLineSchema.parse(line).taxRateBps).toBe(0);
    for (const bad of [
      { unitCost: 10.5 },
      { unitCost: -1 },
      { quantity: 0 },
      { quantity: 1.5 },
      { taxRateBps: 12.5 },
      { taxRateBps: 10_001 },
    ])
      expect(
        purchaseOrderLineSchema.safeParse({ ...line, ...bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    const huge = purchaseOrderLineSchema.safeParse({
      ...line,
      quantity: 1_000_000,
      unitCost: MAX_LINE_AMOUNT_MINOR,
    });
    expect(huge.success).toBe(false);
  });
});

describe('requests', () => {
  const base = { supplierId: id(1), warehouseId: id(2), currency: 'usd' };

  it('normalises currency, defaults shipping and items, and forbids duplicate variants', () => {
    expect(createPurchaseOrderRequestSchema.parse(base)).toMatchObject({
      currency: 'USD',
      shippingCost: 0,
      items: [],
    });
    const dup = createPurchaseOrderRequestSchema.safeParse({
      ...base,
      items: [
        { variantId: id(3), quantity: 1, unitCost: 1 },
        { variantId: id(3), quantity: 2, unitCost: 1 },
      ],
    });
    expect(dup.success).toBe(false);
  });

  it('accepts only real calendar dates for delivery', () => {
    expect(
      createPurchaseOrderRequestSchema.safeParse({ ...base, expectedDeliveryDate: '2026-10-15' })
        .success,
    ).toBe(true);
    expect(
      createPurchaseOrderRequestSchema.safeParse({ ...base, expectedDeliveryDate: '2026-13-01' })
        .success,
    ).toBe(false);
  });

  it('requires something to update', () => {
    expect(updatePurchaseOrderRequestSchema.safeParse({}).success).toBe(false);
    expect(updatePurchaseOrderRequestSchema.safeParse({ notes: null }).success).toBe(true);
  });

  it('receives each line once, in whole positive units', () => {
    const line = { purchaseOrderItemId: id(1), quantity: 5 };
    expect(receivePurchaseOrderRequestSchema.safeParse({ lines: [line] }).success).toBe(true);
    for (const lines of [
      [],
      [line, line],
      [{ ...line, quantity: 0 }],
      [{ ...line, quantity: 2.5 }],
    ])
      expect(receivePurchaseOrderRequestSchema.safeParse({ lines }).success).toBe(false);
  });

  it('formats PO numbers with a six-digit minimum sequence', () => {
    expect(formatPurchaseOrderNumber(2026, 1)).toBe('PO-2026-000001');
    expect(formatPurchaseOrderNumber(2026, 1_234_567)).toBe('PO-2026-1234567');
  });
});
