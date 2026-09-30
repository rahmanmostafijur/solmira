import { adjustStockRequestSchema } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import {
  adjustFieldFor,
  adjustFormSchema,
  onHandAfter,
  parseUnits,
  reorderFormSchema,
  reserveFieldFor,
  reserveFormSchema,
  toAdjustRequest,
  toReceiptRequest,
  toReorderPoint,
  transferFormSchema,
} from './form-values';

const TARGET = {
  warehouseId: '0192f000-0000-7000-8000-000000000001',
  variantId: '0192f000-0000-7000-8000-000000000002',
};

const quantityError = (result: {
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => result.error?.issues.find((issue) => issue.path[0] === 'quantity')?.message;

describe('parseUnits', () => {
  it('reads whole numbers, signed only when asked', () => {
    expect(parseUnits('12')).toBe(12);
    expect(parseUnits(' 7 ')).toBe(7);
    expect(parseUnits('-2')).toBeNull();
    expect(parseUnits('-2', true)).toBe(-2);
    expect(parseUnits('−2', true)).toBe(-2);
    expect(parseUnits('+5', true)).toBe(5);
  });

  it('rejects fractions and text', () => {
    expect(parseUnits('1.5')).toBeNull();
    expect(parseUnits('abc')).toBeNull();
    expect(parseUnits('')).toBeNull();
  });
});

describe('adjustments', () => {
  it('checks the direction of the change against the reason', () => {
    const damaged = adjustFormSchema.safeParse({ reason: 'DAMAGED', quantity: '5', note: '' });
    expect(quantityError(damaged)).toBe('This reason can only remove stock');

    const received = adjustFormSchema.safeParse({ reason: 'RECEIVED', quantity: '-5', note: '' });
    expect(quantityError(received)).toBe('This reason can only add stock');

    const correction = adjustFormSchema.safeParse({
      reason: 'CORRECTION',
      quantity: '-3',
      note: '',
    });
    expect(correction.success).toBe(true);
  });

  it('refuses a zero change and a negative count', () => {
    expect(
      quantityError(adjustFormSchema.safeParse({ reason: 'FOUND', quantity: '0', note: '' })),
    ).toBe('Enter a change other than zero');
    expect(adjustFormSchema.safeParse({ reason: 'COUNT', quantity: '-1', note: '' }).success).toBe(
      false,
    );
    expect(adjustFormSchema.safeParse({ reason: 'COUNT', quantity: '0', note: '' }).success).toBe(
      true,
    );
  });

  it('builds requests the API schema accepts', () => {
    const change = toAdjustRequest(
      adjustFormSchema.parse({ reason: 'LOST', quantity: '-4', note: 'Shelf 3' }),
      TARGET,
    );
    expect(change).toEqual({ ...TARGET, reason: 'LOST', quantityChange: -4, note: 'Shelf 3' });
    expect(adjustStockRequestSchema.safeParse(change).success).toBe(true);

    const counted = toAdjustRequest(
      adjustFormSchema.parse({ reason: 'COUNT', quantity: '18', note: '' }),
      TARGET,
    );
    expect(counted).toEqual({ ...TARGET, reason: 'COUNT', countedQuantity: 18 });
    expect(adjustStockRequestSchema.safeParse(counted).success).toBe(true);
  });

  it('previews the resulting on-hand quantity', () => {
    expect(onHandAfter('RECEIVED', '5', 10)).toBe(15);
    expect(onHandAfter('COUNT', '3', 10)).toBe(3);
    expect(onHandAfter('DAMAGED', 'x', 10)).toBeNull();
  });

  it('shows both server quantity paths on the one input', () => {
    expect(adjustFieldFor('quantityChange')).toBe('quantity');
    expect(adjustFieldFor('countedQuantity')).toBe('quantity');
    expect(adjustFieldFor('variantId')).toBe('');
  });

  it('records new stock as a receipt', () => {
    const receipt = toReceiptRequest({
      productId: 'p',
      variantId: TARGET.variantId,
      warehouseId: TARGET.warehouseId,
      quantity: '40',
      note: '',
    });
    expect(receipt).toEqual({ ...TARGET, reason: 'RECEIVED', quantityChange: 40 });
    expect(adjustStockRequestSchema.safeParse(receipt).success).toBe(true);
  });
});

describe('moving stock out', () => {
  it('caps a transfer at what is available', () => {
    const schema = transferFormSchema(3);
    expect(quantityError(schema.safeParse({ toWarehouseId: 'w', quantity: '4', note: '' }))).toBe(
      'Only 3 available',
    );
    expect(schema.safeParse({ toWarehouseId: 'w', quantity: '3', note: '' }).success).toBe(true);
    expect(schema.safeParse({ toWarehouseId: '', quantity: '1', note: '' }).success).toBe(false);
  });

  it('needs a reference and at least one unit to reserve', () => {
    const schema = reserveFormSchema(10);
    expect(quantityError(schema.safeParse({ quantity: '0', reference: 'x', note: '' }))).toBe(
      'Enter at least 1 whole unit',
    );
    expect(schema.safeParse({ quantity: '2', reference: ' ', note: '' }).success).toBe(false);
    expect(reserveFieldFor('lines.0.quantity')).toBe('quantity');
  });
});

describe('reorder point', () => {
  it('treats an empty value as switching alerts off', () => {
    expect(toReorderPoint(reorderFormSchema.parse({ reorderPoint: '' }))).toBeNull();
    expect(toReorderPoint(reorderFormSchema.parse({ reorderPoint: '12' }))).toBe(12);
    expect(reorderFormSchema.safeParse({ reorderPoint: '-1' }).success).toBe(false);
  });
});
