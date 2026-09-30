import { describe, expect, it } from 'vitest';
import { receiptFingerprint } from './receiving.service.js';

const order = '0199a0b2-0000-7000-8000-000000000001';
const lineA = '0199a0b2-0000-7000-8000-00000000000a';
const lineB = '0199a0b2-0000-7000-8000-00000000000b';

describe('receipt fingerprint (what makes two requests "the same receipt")', () => {
  const request = {
    lines: [
      { purchaseOrderItemId: lineA, quantity: 5 },
      { purchaseOrderItemId: lineB, quantity: 2 },
    ],
    note: 'Pallet 1',
  };

  it('ignores the order in which lines were sent', () => {
    const reordered = { ...request, lines: [...request.lines].reverse() };
    expect(receiptFingerprint(order, reordered)).toBe(receiptFingerprint(order, request));
  });

  it('changes with the order, a quantity, a line or the note', () => {
    const base = receiptFingerprint(order, request);
    const variations = [
      receiptFingerprint(order.replace(/1$/, '2'), request),
      receiptFingerprint(order, {
        ...request,
        lines: [{ purchaseOrderItemId: lineA, quantity: 6 }, request.lines[1]!],
      }),
      receiptFingerprint(order, { ...request, lines: [request.lines[0]!] }),
      receiptFingerprint(order, { ...request, note: 'Pallet 2' }),
    ];
    for (const other of variations) expect(other).not.toBe(base);
  });

  it('treats an absent note and a null note as the same request', () => {
    const withoutNote = { lines: request.lines };
    expect(receiptFingerprint(order, withoutNote)).toBe(
      receiptFingerprint(order, { ...withoutNote, note: null }),
    );
  });
});
