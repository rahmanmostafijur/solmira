import {
  addPurchaseOrderItemRequestSchema,
  createPurchaseOrderRequestSchema,
  receivePurchaseOrderRequestSchema,
  updatePurchaseOrderItemRequestSchema,
  updatePurchaseOrderRequestSchema,
  type PurchaseOrderDetail,
  type PurchaseOrderItem,
} from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import {
  emptyLine,
  fromTaxRateBps,
  headerFormDefaults,
  headerFormSchema,
  lineFieldFor,
  lineFormDefaults,
  lineFormSchema,
  linePreview,
  orderFieldFor,
  orderFormDefaults,
  orderFormSchema,
  orderPreview,
  parseTaxPercent,
  receiveFieldFor,
  receiveFormDefaults,
  receiveFormSchema,
  summarizeReceipt,
  toCreatePurchaseOrderRequest,
  toLineRequest,
  toReceiveRequest,
  toUpdateLineRequest,
  toUpdatePurchaseOrderRequest,
} from './form-values';

const SUPPLIER = '0192f000-0000-7000-8000-000000000001';
const WAREHOUSE = '0192f000-0000-7000-8000-000000000002';
const VARIANT_A = '0192f000-0000-7000-8000-00000000000a';
const VARIANT_B = '0192f000-0000-7000-8000-00000000000b';
const ITEM_A = '0192f000-0000-7000-8000-0000000000a1';
const ITEM_B = '0192f000-0000-7000-8000-0000000000b1';

const issueAt = (
  result: { error?: { issues: { path: PropertyKey[]; message: string }[] } },
  path: string,
) => result.error?.issues.find((issue) => issue.path.join('.') === path)?.message;

const line = (overrides: Partial<ReturnType<typeof emptyLine>> = {}) => ({
  ...emptyLine(),
  productId: 'p',
  variantId: VARIANT_A,
  quantity: '10',
  unitCost: '12.50',
  taxPercent: '15',
  ...overrides,
});

function item(overrides: Partial<PurchaseOrderItem> = {}): PurchaseOrderItem {
  return {
    id: ITEM_A,
    productId: 'p',
    productName: 'Desk',
    variantId: VARIANT_A,
    sku: 'DESK-OAK',
    variantName: 'Oak',
    orderedQuantity: 10,
    receivedQuantity: 0,
    remainingQuantity: 10,
    unitCost: 1250,
    taxRateBps: 1500,
    subtotal: 12500,
    tax: 1875,
    total: 14375,
    ...overrides,
  };
}

function order(overrides: Partial<PurchaseOrderDetail> = {}): PurchaseOrderDetail {
  return {
    id: 'o',
    number: 'PO-2026-000001',
    status: 'DRAFT',
    supplier: { id: SUPPLIER, companyName: 'Acme', status: 'ACTIVE' },
    warehouse: { id: WAREHOUSE, code: 'MAIN', name: 'Main', status: 'ACTIVE' },
    currency: 'USD',
    itemCount: 1,
    total: 15375,
    expectedDeliveryDate: '2026-10-15',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    notes: null,
    subtotal: 12500,
    tax: 1875,
    shippingCost: 1000,
    createdBy: 'u1',
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    receivedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    items: [item()],
    receiving: {
      orderedUnits: 10,
      receivedUnits: 0,
      remainingUnits: 10,
      receiptCount: 0,
      lastReceivedAt: null,
    },
    ...overrides,
  };
}

describe('tax percentages', () => {
  it('turns a percentage into basis points', () => {
    expect(parseTaxPercent('15')).toBe(1500);
    expect(parseTaxPercent('7.25')).toBe(725);
    expect(parseTaxPercent('7.5')).toBe(750);
    expect(parseTaxPercent(' 20% ')).toBe(2000);
    expect(parseTaxPercent('')).toBe(0);
    expect(parseTaxPercent('100')).toBe(10000);
  });

  it('rejects rates above 100%, negatives and extra decimals', () => {
    expect(parseTaxPercent('100.01')).toBeNull();
    expect(parseTaxPercent('-5')).toBeNull();
    expect(parseTaxPercent('7.125')).toBeNull();
    expect(parseTaxPercent('abc')).toBeNull();
  });

  it('shows basis points back as a percentage', () => {
    expect(fromTaxRateBps(1500)).toBe('15');
    expect(fromTaxRateBps(750)).toBe('7.5');
    expect(fromTaxRateBps(725)).toBe('7.25');
    expect(fromTaxRateBps(0)).toBe('0');
  });
});

describe('lines', () => {
  it('builds a line request the API schema accepts, in minor units and basis points', () => {
    const request = toLineRequest(lineFormSchema('USD').parse(line()), 'USD');
    expect(request).toEqual({
      variantId: VARIANT_A,
      quantity: 10,
      unitCost: 1250,
      taxRateBps: 1500,
    });
    expect(addPurchaseOrderItemRequestSchema.safeParse(request).success).toBe(true);
  });

  it('uses the decimals of the order currency', () => {
    expect(toLineRequest(line({ unitCost: '1250' }), 'JPY').unitCost).toBe(1250);
    expect(issueAt(lineFormSchema('JPY').safeParse(line({ unitCost: '12.5' })), 'unitCost')).toBe(
      'Enter an amount such as 1250',
    );
  });

  it('checks quantity, cost and tax', () => {
    const schema = lineFormSchema('USD');
    expect(issueAt(schema.safeParse(line({ quantity: '0' })), 'quantity')).toBe(
      'Enter at least 1 whole unit',
    );
    expect(issueAt(schema.safeParse(line({ quantity: '1.5' })), 'quantity')).toBeTruthy();
    expect(issueAt(schema.safeParse(line({ unitCost: '' })), 'unitCost')).toBeTruthy();
    expect(issueAt(schema.safeParse(line({ taxPercent: '150' })), 'taxPercent')).toBeTruthy();
    expect(issueAt(schema.safeParse(line({ variantId: '' })), 'variantId')).toBe(
      'Choose a variant',
    );
  });

  it('refuses a line whose total exceeds the per-line limit', () => {
    const result = lineFormSchema('USD').safeParse(
      line({ quantity: '1000000', unitCost: '100000000' }),
    );
    expect(issueAt(result, 'unitCost')).toMatch(/too large/);
  });

  it('previews line amounts with the shared arithmetic', () => {
    expect(linePreview(line(), 'USD')).toEqual({ subtotal: 12500, tax: 1875, total: 14375 });
    expect(linePreview(line({ quantity: '' }), 'USD')).toBeNull();
  });

  it('sends only the amounts that changed', () => {
    const saved = item();
    const unchanged = lineFormSchema('USD').parse(lineFormDefaults(saved, 'USD'));
    expect(toUpdateLineRequest(unchanged, saved, 'USD')).toBeNull();

    const change = toUpdateLineRequest({ ...unchanged, quantity: '12' }, saved, 'USD');
    expect(change).toEqual({ quantity: 12 });
    expect(updatePurchaseOrderItemRequestSchema.safeParse(change).success).toBe(true);
  });

  it('shows the server tax path on the percentage input', () => {
    expect(lineFieldFor('taxRateBps')).toBe('taxPercent');
    expect(lineFieldFor('quantity')).toBe('quantity');
    expect(lineFieldFor('somethingElse')).toBe('');
  });
});

describe('new order', () => {
  const valid = {
    ...orderFormDefaults('usd'),
    supplierId: SUPPLIER,
    warehouseId: WAREHOUSE,
    expectedDeliveryDate: '2026-10-15',
    shippingCost: '10',
    items: [line(), line({ variantId: VARIANT_B, quantity: '2', unitCost: '5', taxPercent: '' })],
  };

  it('builds a create request the API schema accepts', () => {
    const request = toCreatePurchaseOrderRequest(orderFormSchema.parse(valid));
    expect(request).toEqual({
      supplierId: SUPPLIER,
      warehouseId: WAREHOUSE,
      currency: 'USD',
      expectedDeliveryDate: '2026-10-15',
      shippingCost: 1000,
      items: [
        { variantId: VARIANT_A, quantity: 10, unitCost: 1250, taxRateBps: 1500 },
        { variantId: VARIANT_B, quantity: 2, unitCost: 500, taxRateBps: 0 },
      ],
    });
    expect(createPurchaseOrderRequestSchema.safeParse(request).success).toBe(true);
  });

  it('allows a draft without lines, shipping or a date', () => {
    const request = toCreatePurchaseOrderRequest(
      orderFormSchema.parse({ ...valid, items: [], shippingCost: '', expectedDeliveryDate: '' }),
    );
    expect(request).toEqual({
      supplierId: SUPPLIER,
      warehouseId: WAREHOUSE,
      currency: 'USD',
      shippingCost: 0,
      items: [],
    });
    expect(createPurchaseOrderRequestSchema.safeParse(request).success).toBe(true);
  });

  it('refuses the same variant on two lines', () => {
    const result = orderFormSchema.safeParse({ ...valid, items: [line(), line()] });
    expect(issueAt(result, 'items.1.variantId')).toMatch(/Already on another line/);
    expect(issueAt(result, 'items.0.variantId')).toBeUndefined();
  });

  it('needs a supplier, a warehouse and a valid shipping amount', () => {
    const result = orderFormSchema.safeParse({
      ...valid,
      supplierId: '',
      warehouseId: '',
      shippingCost: 'ten',
    });
    expect(issueAt(result, 'supplierId')).toBe('Choose a supplier');
    expect(issueAt(result, 'warehouseId')).toBe('Choose a warehouse');
    expect(issueAt(result, 'shippingCost')).toBeTruthy();
  });

  it('previews order totals over complete lines', () => {
    const totals = orderPreview(
      [line(), line({ variantId: VARIANT_B, quantity: '' })],
      '10.00',
      'USD',
    );
    expect(totals).toEqual({
      subtotal: 12500,
      tax: 1875,
      shippingCost: 1000,
      total: 15375,
      incompleteLines: 1,
    });
  });

  it('maps server paths onto the form', () => {
    expect(orderFieldFor('items.2.taxRateBps')).toBe('items.2.taxPercent');
    expect(orderFieldFor('items.2.variantId')).toBe('items.2.variantId');
    expect(orderFieldFor('items.1')).toBe('items.1.variantId');
    expect(orderFieldFor('items')).toBe('items.root');
    expect(orderFieldFor('supplierId')).toBe('supplierId');
    expect(orderFieldFor('unknown')).toBe('');
  });
});

describe('editing an order', () => {
  it('sends only changed draft fields', () => {
    const draft = order();
    const values = headerFormSchema.parse(headerFormDefaults(draft));
    expect(toUpdatePurchaseOrderRequest(values, draft)).toBeNull();

    const change = toUpdatePurchaseOrderRequest(
      { ...values, shippingCost: '25', notes: 'Call before delivery' },
      draft,
    );
    expect(change).toEqual({ shippingCost: 2500, notes: 'Call before delivery' });
    expect(updatePurchaseOrderRequestSchema.safeParse(change).success).toBe(true);
  });

  it('clears a date or a note with null', () => {
    const draft = order({ notes: 'Old' });
    const values = headerFormSchema.parse(headerFormDefaults(draft));
    expect(
      toUpdatePurchaseOrderRequest({ ...values, notes: '', expectedDeliveryDate: '' }, draft),
    ).toEqual({ notes: null, expectedDeliveryDate: null });
  });

  it('sends only notes and the delivery date once submitted', () => {
    const submitted = order({ status: 'APPROVED' });
    const values = headerFormSchema.parse(headerFormDefaults(submitted));
    expect(
      toUpdatePurchaseOrderRequest(
        { ...values, shippingCost: '99', expectedDeliveryDate: '2026-11-01' },
        submitted,
      ),
    ).toEqual({ expectedDeliveryDate: '2026-11-01' });
    expect(toUpdatePurchaseOrderRequest({ ...values, shippingCost: '99' }, submitted)).toBeNull();
  });
});

describe('receiving', () => {
  const items = [
    item(),
    item({ id: ITEM_B, sku: 'CHAIR', productName: 'Chair', variantName: 'Chair' }),
  ];
  const remaining = [
    { id: ITEM_A, remainingQuantity: 20 },
    { id: ITEM_B, remainingQuantity: 5 },
  ];
  const withQuantities = (a: string, b: string, note = '') => ({
    lines: [
      { purchaseOrderItemId: ITEM_A, quantity: a },
      { purchaseOrderItemId: ITEM_B, quantity: b },
    ],
    note,
  });

  it('starts every line empty', () => {
    expect(receiveFormDefaults(remaining)).toEqual(withQuantities('', ''));
  });

  it('builds a receipt of the lines with a quantity, accepted by the API schema', () => {
    const values = receiveFormSchema(remaining).parse(withQuantities('', '5', 'Pallet 1'));
    const request = toReceiveRequest(values);
    expect(request).toEqual({
      lines: [{ purchaseOrderItemId: ITEM_B, quantity: 5 }],
      note: 'Pallet 1',
    });
    expect(receivePurchaseOrderRequestSchema.safeParse(request).success).toBe(true);
  });

  it('caps each line at what remains and accepts only whole units', () => {
    const schema = receiveFormSchema(remaining);
    expect(issueAt(schema.safeParse(withQuantities('21', '')), 'lines.0.quantity')).toBe(
      'Only 20 remaining',
    );
    expect(issueAt(schema.safeParse(withQuantities('1.5', '')), 'lines.0.quantity')).toBe(
      'Whole units only',
    );
    expect(schema.safeParse(withQuantities('20', '5')).success).toBe(true);
  });

  it('needs at least one line with units', () => {
    const schema = receiveFormSchema(remaining);
    expect(issueAt(schema.safeParse(withQuantities('', '')), 'lines')).toBeTruthy();
    expect(issueAt(schema.safeParse(withQuantities('0', '0')), 'lines')).toBeTruthy();
  });

  it('maps an over-receipt back onto the row it came from', () => {
    const values = receiveFormSchema(remaining).parse(withQuantities('', '5'));
    const fieldFor = receiveFieldFor(toReceiveRequest(values), values);
    expect(fieldFor('lines.0.quantity')).toBe('lines.1.quantity');
    expect(fieldFor('lines.4.quantity')).toBe('');
    expect(fieldFor('note')).toBe('note');
  });

  it('summarizes units per SKU for the confirmation', () => {
    const request = toReceiveRequest(receiveFormSchema(remaining).parse(withQuantities('3', '2')));
    expect(summarizeReceipt(request, items)).toEqual({
      lines: [
        { sku: 'DESK-OAK', name: 'Desk · Oak', quantity: 3 },
        { sku: 'CHAIR', name: 'Chair', quantity: 2 },
      ],
      units: 5,
    });
  });
});
