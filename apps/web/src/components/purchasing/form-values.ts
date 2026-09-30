import {
  MAX_LINE_AMOUNT_MINOR,
  MAX_MOVEMENT_QUANTITY,
  MAX_PURCHASE_ORDER_LINES,
  MAX_SHIPPING_MINOR,
  MAX_TAX_RATE_BPS,
  MAX_UNIT_COST_MINOR,
  PURCHASE_ORDER_OPEN_FIELDS,
  isPurchaseOrderEditable,
  lineAmounts,
  orderTotals,
  type AddPurchaseOrderItemRequest,
  type CreatePurchaseOrderRequest,
  type LineAmounts,
  type OrderTotals,
  type PurchaseOrderDetail,
  type PurchaseOrderItem,
  type ReceivePurchaseOrderRequest,
  type UpdatePurchaseOrderItemRequest,
  type UpdatePurchaseOrderRequest,
} from '@solmira/contracts';
import { z } from 'zod';
import { fromMinorUnits, toMinorUnits } from '../../lib/money';
import { parseUnits } from '../inventory/form-values';

/**
 * Form state is text, exactly as typed: money as decimals in the order's currency, tax as a
 * percentage. The API takes integer minor units and basis points. These schemas check the text
 * against the API's own limits, and the mappers below translate. The server recalculates every
 * amount; the previews here use the same shared arithmetic (lineAmounts, orderTotals).
 */

const count = (n: number) => n.toLocaleString('en');
const blankToNull = (value: string) => (value === '' ? null : value);

// ---- parsing ------------------------------------------------------------------------------------

/** "15" -> 1500, "7.25" -> 725, "" -> 0. Null for anything that is not 0-100 with 2 decimals. */
export function parseTaxPercent(text: string): number | null {
  const value = text.trim().replace(/%$/, '').trim();
  if (value === '') return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps <= MAX_TAX_RATE_BPS ? bps : null;
}

/** 1500 -> "15", 750 -> "7.5", 725 -> "7.25", for pre-filling an input. */
export const fromTaxRateBps = (bps: number): string => String(bps / 100);

/** Shipping may be left blank for none. */
const parseShipping = (text: string, currency: string) =>
  text.trim() === '' ? 0 : toMinorUnits(text, currency);

// ---- lines --------------------------------------------------------------------------------------

const lineShape = {
  productId: z.string(),
  variantId: z.string().min(1, 'Choose a variant'),
  quantity: z.string().trim(),
  unitCost: z.string().trim(),
  taxPercent: z.string().trim(),
};
const lineObject = z.object(lineShape);

export type LineFormInput = z.input<typeof lineObject>;
export type LineFormValues = z.output<typeof lineObject>;

interface ParsedLine {
  readonly quantity: number;
  readonly unitCost: number;
  readonly taxRateBps: number;
}

/** The typed values of a line, or null while any of them is not a valid number yet. */
function parseLine(line: LineFormInput, currency: string): ParsedLine | null {
  const quantity = parseUnits(line.quantity);
  const unitCost = toMinorUnits(line.unitCost, currency);
  const taxRateBps = parseTaxPercent(line.taxPercent);
  if (quantity === null || quantity < 1 || unitCost === null || taxRateBps === null) return null;
  return { quantity, unitCost, taxRateBps };
}

function lineIssues(
  line: LineFormInput,
  currency: string,
  ctx: z.RefinementCtx,
  path: (string | number)[],
) {
  const issue = (field: keyof LineFormInput, message: string) =>
    ctx.addIssue({ code: 'custom', path: [...path, field], message });

  const quantity = parseUnits(line.quantity);
  if (quantity === null || quantity < 1) issue('quantity', 'Enter at least 1 whole unit');
  else if (quantity > MAX_MOVEMENT_QUANTITY) {
    issue('quantity', `At most ${count(MAX_MOVEMENT_QUANTITY)} units per line`);
  }

  const unitCost = toMinorUnits(line.unitCost, currency);
  if (unitCost === null) {
    issue('unitCost', `Enter an amount such as ${fromMinorUnits(1250, currency)}`);
  } else if (unitCost > MAX_UNIT_COST_MINOR) issue('unitCost', 'This unit cost is too large');

  if (parseTaxPercent(line.taxPercent) === null) {
    issue('taxPercent', 'A percentage from 0 to 100, e.g. 15 or 7.5');
  }

  const parsed = parseLine(line, currency);
  if (
    parsed &&
    lineAmounts(parsed.quantity, parsed.unitCost, parsed.taxRateBps).total > MAX_LINE_AMOUNT_MINOR
  ) {
    issue('unitCost', 'This line is too large; split it or lower the quantity');
  }
}

/** One line on its own, as in the add-line and edit-line dialogs of a draft. */
export function lineFormSchema(currency: string) {
  return lineObject.superRefine((line, ctx) => lineIssues(line, currency, ctx, []));
}

export const emptyLine = (): LineFormInput => ({
  productId: '',
  variantId: '',
  quantity: '',
  unitCost: '',
  taxPercent: '',
});

export function toLineRequest(line: LineFormValues, currency: string): AddPurchaseOrderItemRequest {
  const parsed = parseLine(line, currency);
  return {
    variantId: line.variantId,
    quantity: parsed?.quantity ?? 0,
    unitCost: parsed?.unitCost ?? 0,
    taxRateBps: parsed?.taxRateBps ?? 0,
  };
}

export function lineFormDefaults(item: PurchaseOrderItem, currency: string): LineFormInput {
  return {
    productId: item.productId,
    variantId: item.variantId,
    quantity: String(item.orderedQuantity),
    unitCost: fromMinorUnits(item.unitCost, currency),
    taxPercent: fromTaxRateBps(item.taxRateBps),
  };
}

/** Only the changed amounts of a line, or null when it matches the saved line. */
export function toUpdateLineRequest(
  values: LineFormValues,
  item: PurchaseOrderItem,
  currency: string,
): UpdatePurchaseOrderItemRequest | null {
  const next = toLineRequest(values, currency);
  const change: UpdatePurchaseOrderItemRequest = {
    ...(next.quantity !== item.orderedQuantity ? { quantity: next.quantity } : {}),
    ...(next.unitCost !== item.unitCost ? { unitCost: next.unitCost } : {}),
    ...(next.taxRateBps !== item.taxRateBps ? { taxRateBps: next.taxRateBps } : {}),
  };
  return Object.keys(change).length > 0 ? change : null;
}

/** Live amounts of a line as typed so far, or null while it is incomplete. */
export function linePreview(line: LineFormInput, currency: string): LineAmounts | null {
  const parsed = parseLine(line, currency);
  return parsed ? lineAmounts(parsed.quantity, parsed.unitCost, parsed.taxRateBps) : null;
}

/** Order totals over the lines that are complete; shipping counts once it is a valid amount. */
export function orderPreview(
  lines: readonly LineFormInput[],
  shippingCost: string,
  currency: string,
): OrderTotals & { readonly incompleteLines: number } {
  const amounts = lines.map((line) => linePreview(line, currency));
  const complete = amounts.filter((amount): amount is LineAmounts => amount !== null);
  return {
    ...orderTotals(complete, parseShipping(shippingCost, currency) ?? 0),
    incompleteLines: amounts.length - complete.length,
  };
}

/** The server names a line's tax `taxRateBps`; the form shows it as a percentage. */
export const lineFieldFor = (path: string) =>
  path === 'taxRateBps'
    ? 'taxPercent'
    : path === 'quantity' || path === 'unitCost' || path === 'variantId'
      ? path
      : '';

// ---- order header -------------------------------------------------------------------------------

const headerShape = {
  supplierId: z.string().min(1, 'Choose a supplier'),
  warehouseId: z.string().min(1, 'Choose a warehouse'),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter code such as USD'),
  expectedDeliveryDate: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a date like 2026-10-15'),
  notes: z.string().trim().max(2000, 'At most 2,000 characters'),
  shippingCost: z.string().trim(),
};

function shippingIssue(values: { shippingCost: string; currency: string }, ctx: z.RefinementCtx) {
  const shipping = parseShipping(values.shippingCost, values.currency);
  if (shipping === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['shippingCost'],
      message: `Enter an amount such as ${fromMinorUnits(1250, values.currency)}, or leave it empty`,
    });
  } else if (shipping > MAX_SHIPPING_MINOR) {
    ctx.addIssue({ code: 'custom', path: ['shippingCost'], message: 'This amount is too large' });
  }
}

export const headerFormSchema = z.object(headerShape).superRefine(shippingIssue);

export type HeaderFormInput = z.input<typeof headerFormSchema>;
export type HeaderFormValues = z.output<typeof headerFormSchema>;

export function headerFormDefaults(order: PurchaseOrderDetail): HeaderFormInput {
  return {
    supplierId: order.supplier.id,
    warehouseId: order.warehouse.id,
    currency: order.currency,
    expectedDeliveryDate: order.expectedDeliveryDate?.slice(0, 10) ?? '',
    notes: order.notes ?? '',
    shippingCost:
      order.shippingCost === 0 ? '' : fromMinorUnits(order.shippingCost, order.currency),
  };
}

function headerFields(values: HeaderFormValues) {
  return {
    supplierId: values.supplierId,
    warehouseId: values.warehouseId,
    currency: values.currency,
    expectedDeliveryDate: blankToNull(values.expectedDeliveryDate),
    notes: blankToNull(values.notes),
    shippingCost: parseShipping(values.shippingCost, values.currency) ?? 0,
  };
}

/**
 * Only the changed fields, or null when nothing changed. Once an order is submitted only notes
 * and the expected delivery date may still change, so nothing else is ever sent for it.
 */
export function toUpdatePurchaseOrderRequest(
  values: HeaderFormValues,
  order: PurchaseOrderDetail,
): UpdatePurchaseOrderRequest | null {
  const next = headerFields(values);
  const before = headerFields(headerFormSchema.parse(headerFormDefaults(order)));
  const allowed: readonly string[] = isPurchaseOrderEditable(order.status)
    ? Object.keys(next)
    : PURCHASE_ORDER_OPEN_FIELDS;
  const changed = Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => allowed.includes(key) && before[key as keyof typeof before] !== value,
    ),
  );
  return Object.keys(changed).length > 0 ? (changed as UpdatePurchaseOrderRequest) : null;
}

const HEADER_FIELDS: ReadonlySet<string> = new Set(Object.keys(headerShape));
export const headerFieldFor = (path: string) => (HEADER_FIELDS.has(path) ? path : '');

// ---- new order ----------------------------------------------------------------------------------

export const orderFormSchema = z
  .object({
    ...headerShape,
    items: z
      .array(lineObject)
      .max(MAX_PURCHASE_ORDER_LINES, `At most ${MAX_PURCHASE_ORDER_LINES} lines per order`),
  })
  .superRefine((values, ctx) => {
    shippingIssue(values, ctx);
    const seen = new Set<string>();
    values.items.forEach((line, index) => {
      lineIssues(line, values.currency, ctx, ['items', index]);
      if (line.variantId === '') return;
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'variantId'],
          message: 'Already on another line; change that quantity instead',
        });
      }
      seen.add(line.variantId);
    });
  });

export type OrderFormInput = z.input<typeof orderFormSchema>;
export type OrderFormValues = z.output<typeof orderFormSchema>;

export const orderFormDefaults = (currency: string): OrderFormInput => ({
  supplierId: '',
  warehouseId: '',
  currency,
  expectedDeliveryDate: '',
  notes: '',
  shippingCost: '',
  items: [emptyLine()],
});

export function toCreatePurchaseOrderRequest(values: OrderFormValues): CreatePurchaseOrderRequest {
  const header = headerFields(values);
  return {
    supplierId: header.supplierId,
    warehouseId: header.warehouseId,
    currency: header.currency,
    ...(header.expectedDeliveryDate ? { expectedDeliveryDate: header.expectedDeliveryDate } : {}),
    ...(header.notes ? { notes: header.notes } : {}),
    shippingCost: header.shippingCost,
    items: values.items.map((line) => toLineRequest(line, values.currency)),
  };
}

/** Server paths of a new order onto the form: a line's tax shows on its percentage input. */
export function orderFieldFor(path: string): string {
  const line = /^items\.(\d+)(?:\.(\w+))?$/.exec(path);
  if (line) {
    const field = line[2] ? lineFieldFor(line[2]) : 'variantId';
    return `items.${line[1]}.${field || 'variantId'}`;
  }
  if (path === 'items') return 'items.root';
  return headerFieldFor(path);
}

// ---- receiving ----------------------------------------------------------------------------------

export interface ReceivableLine {
  readonly id: string;
  readonly remainingQuantity: number;
}

export function receiveFormSchema(items: readonly ReceivableLine[]) {
  const remainingOf = new Map(items.map((item) => [item.id, item.remainingQuantity]));
  return z
    .object({
      lines: z.array(z.object({ purchaseOrderItemId: z.string(), quantity: z.string().trim() })),
      note: z.string().trim().max(500, 'At most 500 characters'),
    })
    .superRefine((values, ctx) => {
      let receiving = 0;
      let invalid = false;
      values.lines.forEach((line, index) => {
        if (line.quantity === '') return;
        const path = ['lines', index, 'quantity'];
        const units = parseUnits(line.quantity);
        const remaining = remainingOf.get(line.purchaseOrderItemId) ?? 0;
        let message: string | null = null;
        if (units === null) message = 'Whole units only';
        else if (units > remaining) message = `Only ${count(remaining)} remaining`;
        else if (units > MAX_MOVEMENT_QUANTITY) {
          message = `At most ${count(MAX_MOVEMENT_QUANTITY)} units at a time`;
        }
        if (message) {
          invalid = true;
          ctx.addIssue({ code: 'custom', path, message });
        } else if (units !== null && units > 0) receiving += 1;
      });
      if (!invalid && receiving === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines'],
          message: 'Enter a quantity for at least one line',
        });
      }
    });
}

export type ReceiveFormInput = z.input<ReturnType<typeof receiveFormSchema>>;
export type ReceiveFormValues = z.output<ReturnType<typeof receiveFormSchema>>;

export const receiveFormDefaults = (items: readonly ReceivableLine[]): ReceiveFormInput => ({
  lines: items.map((item) => ({ purchaseOrderItemId: item.id, quantity: '' })),
  note: '',
});

/** Lines left empty or at zero are not part of the receipt; a blank note is left out. */
export function toReceiveRequest(values: ReceiveFormValues): ReceivePurchaseOrderRequest {
  const lines = values.lines.flatMap((line) => {
    const quantity = parseUnits(line.quantity) ?? 0;
    return quantity > 0 ? [{ purchaseOrderItemId: line.purchaseOrderItemId, quantity }] : [];
  });
  return { lines, ...(values.note === '' ? {} : { note: values.note }) };
}

/**
 * The request leaves out empty lines, so `lines.1.quantity` in the server's answer is the second
 * line received, not the second on screen: map it back through the item id.
 */
export function receiveFieldFor(
  request: ReceivePurchaseOrderRequest,
  values: Pick<ReceiveFormValues, 'lines'>,
): (path: string) => string {
  return (path) => {
    const line = /^lines\.(\d+)(?:\.quantity)?$/.exec(path);
    if (line) {
      const itemId = request.lines[Number(line[1])]?.purchaseOrderItemId;
      const index = values.lines.findIndex((l) => l.purchaseOrderItemId === itemId);
      return index >= 0 ? `lines.${index}.quantity` : '';
    }
    return path === 'note' ? 'note' : '';
  };
}

export interface ReceiptPreviewLine {
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
}

/** What the confirmation lists: units per SKU, in the order's line order. */
export function summarizeReceipt(
  request: ReceivePurchaseOrderRequest,
  items: readonly Pick<PurchaseOrderItem, 'id' | 'sku' | 'productName' | 'variantName'>[],
): { lines: ReceiptPreviewLine[]; units: number } {
  const quantities = new Map(
    request.lines.map((line) => [line.purchaseOrderItemId, line.quantity]),
  );
  const lines = items.flatMap((item) => {
    const quantity = quantities.get(item.id);
    if (!quantity) return [];
    const name =
      item.variantName === item.productName
        ? item.productName
        : `${item.productName} · ${item.variantName}`;
    return [{ sku: item.sku, name, quantity }];
  });
  return { lines, units: lines.reduce((sum, line) => sum + line.quantity, 0) };
}
