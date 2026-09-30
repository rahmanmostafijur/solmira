import { PURCHASE_ORDER_STATUSES } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  describeIssuePath,
  formatDeliveryDate,
  formatTaxRate,
  isDeliveryOverdue,
  localToday,
  onTimeRate,
  receivedPercent,
} from './labels';

describe('purchasing labels', () => {
  it('names and colors every purchase order status', () => {
    for (const status of PURCHASE_ORDER_STATUSES) {
      expect(PURCHASE_ORDER_STATUS_LABELS[status].label).toBeTruthy();
      expect(PURCHASE_ORDER_STATUS_LABELS[status].tone).toBeTruthy();
    }
    expect(Object.keys(PURCHASE_ORDER_STATUS_LABELS)).toHaveLength(PURCHASE_ORDER_STATUSES.length);
  });

  it('marks final statuses apart from open ones', () => {
    expect(PURCHASE_ORDER_STATUS_LABELS.RECEIVED.tone).toBe('ok');
    expect(PURCHASE_ORDER_STATUS_LABELS.CANCELLED.tone).toBe('danger');
  });
});

describe('formatDeliveryDate', () => {
  it('reads a calendar day as the same day in every time zone', () => {
    expect(formatDeliveryDate('2026-10-15', 'en-US')).toBe('Oct 15, 2026');
    expect(formatDeliveryDate('2026-01-01', 'en-US')).toBe('Jan 1, 2026');
  });
});

describe('isDeliveryOverdue', () => {
  it('flags open orders whose expected day has passed', () => {
    expect(isDeliveryOverdue('2026-09-30', 'APPROVED', '2026-10-01')).toBe(true);
    expect(isDeliveryOverdue('2026-10-01', 'APPROVED', '2026-10-01')).toBe(false);
    expect(isDeliveryOverdue('2026-09-30', 'PARTIALLY_RECEIVED', '2026-10-01')).toBe(true);
  });

  it('never flags drafts, closed orders or orders without a date', () => {
    expect(isDeliveryOverdue('2026-09-30', 'DRAFT', '2026-10-01')).toBe(false);
    expect(isDeliveryOverdue('2026-09-30', 'RECEIVED', '2026-10-01')).toBe(false);
    expect(isDeliveryOverdue('2026-09-30', 'CANCELLED', '2026-10-01')).toBe(false);
    expect(isDeliveryOverdue(null, 'SUBMITTED', '2026-10-01')).toBe(false);
  });

  it('builds today from the local calendar', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('formatTaxRate', () => {
  it('shows basis points as a percentage', () => {
    expect(formatTaxRate(1500)).toBe('15%');
    expect(formatTaxRate(725)).toBe('7.25%');
    expect(formatTaxRate(0)).toBe('0%');
  });
});

describe('receivedPercent', () => {
  it('rounds down so only a complete order shows 100%', () => {
    expect(receivedPercent({ orderedUnits: 3, receivedUnits: 2 })).toBe(66);
    expect(receivedPercent({ orderedUnits: 1000, receivedUnits: 999 })).toBe(99);
    expect(receivedPercent({ orderedUnits: 10, receivedUnits: 10 })).toBe(100);
    expect(receivedPercent({ orderedUnits: 0, receivedUnits: 0 })).toBe(0);
  });
});

describe('onTimeRate', () => {
  it('is the share of orders with an expected date that arrived on time', () => {
    expect(onTimeRate({ onTimeOrders: 3, ordersWithExpectedDate: 4 })).toBe(75);
    expect(onTimeRate({ onTimeOrders: 2, ordersWithExpectedDate: 3 })).toBe(67);
  });

  it('is unknown when no order had an expected date', () => {
    expect(onTimeRate({ onTimeOrders: 0, ordersWithExpectedDate: 0 })).toBeNull();
  });
});

describe('describeIssuePath', () => {
  it('names the line an issue points at', () => {
    const items = [{ sku: 'A-1' }, { sku: 'B-2' }, { sku: 'C-3' }];
    expect(describeIssuePath('items.2.variantId', items)).toBe('Line 3 (C-3)');
    expect(describeIssuePath('items.7.quantity', items)).toBe('Line 8');
    expect(describeIssuePath('items.0', items)).toBe('Line 1 (A-1)');
  });

  it('names order fields in words', () => {
    expect(describeIssuePath('supplierId')).toBe('Supplier');
    expect(describeIssuePath('items')).toBe('Lines');
    expect(describeIssuePath('somethingElse')).toBe('somethingElse');
  });
});
