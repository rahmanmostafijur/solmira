import {
  ADJUSTMENT_REASONS,
  INVENTORY_MOVEMENT_TYPES,
  RESERVATION_STATUSES,
} from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_REASON_LABELS,
  MOVEMENT_TYPE_LABELS,
  RESERVATION_STATUS_LABELS,
  formatQuantityChange,
  quantityChangeClass,
} from './labels';

describe('inventory labels', () => {
  it('names every movement type', () => {
    for (const type of INVENTORY_MOVEMENT_TYPES) expect(MOVEMENT_TYPE_LABELS[type]).toBeTruthy();
    expect(Object.keys(MOVEMENT_TYPE_LABELS)).toHaveLength(INVENTORY_MOVEMENT_TYPES.length);
  });

  it('names every adjustment reason', () => {
    for (const reason of ADJUSTMENT_REASONS) expect(ADJUSTMENT_REASON_LABELS[reason]).toBeTruthy();
    expect(Object.keys(ADJUSTMENT_REASON_LABELS)).toHaveLength(ADJUSTMENT_REASONS.length);
  });

  it('names and colors every reservation status', () => {
    for (const status of RESERVATION_STATUSES) {
      expect(RESERVATION_STATUS_LABELS[status].label).toBeTruthy();
      expect(RESERVATION_STATUS_LABELS[status].tone).toBeTruthy();
    }
  });
});

describe('formatQuantityChange', () => {
  it('signs gains with a plus', () => {
    expect(formatQuantityChange(5)).toBe('+5');
  });

  it('signs losses with a real minus sign', () => {
    expect(formatQuantityChange(-2)).toBe('−2');
  });

  it('shows no change as a bare zero', () => {
    expect(formatQuantityChange(0)).toBe('0');
  });

  it('groups thousands', () => {
    expect(formatQuantityChange(-12500)).toBe('−12,500');
  });

  it('colors gains and losses', () => {
    expect(quantityChangeClass(1)).toBe('text-ok');
    expect(quantityChangeClass(-1)).toBe('text-danger');
    expect(quantityChangeClass(0)).toBe('text-ink-muted');
  });
});
