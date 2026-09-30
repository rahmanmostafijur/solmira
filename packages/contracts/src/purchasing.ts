import { z } from 'zod';
import { currencySchema } from './catalog.js';
import { MAX_MOVEMENT_QUANTITY } from './inventory.js';
import { paginationQuerySchema, searchTermSchema, sortDirectionSchema } from './pagination.js';

// ---- lifecycle ----------------------------------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/**
 * The purchase order state machine. Each move is caused by exactly one business action:
 * submit, approve, cancel, or a receipt (which decides between PARTIALLY_RECEIVED and RECEIVED
 * from the aggregate received quantities). RECEIVED and CANCELLED are final. Cancelling a
 * partially received order closes the outstanding quantity; what was received stays in stock.
 */
export const PURCHASE_ORDER_TRANSITIONS: Readonly<
  Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>
> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionPurchaseOrder(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return PURCHASE_ORDER_TRANSITIONS[from].includes(to);
}

/** Only drafts can change supplier, warehouse, currency, shipping or lines. */
export const isPurchaseOrderEditable = (status: PurchaseOrderStatus): boolean => status === 'DRAFT';
/** Notes and the expected delivery date stay editable while the order is still open. */
export const isPurchaseOrderOpen = (status: PurchaseOrderStatus): boolean =>
  status !== 'RECEIVED' && status !== 'CANCELLED';
export const isPurchaseOrderReceivable = (status: PurchaseOrderStatus): boolean =>
  status === 'APPROVED' || status === 'PARTIALLY_RECEIVED';

/** Status after a receipt, from the aggregate of every line. */
export function statusAfterReceipt(
  lines: readonly { orderedQuantity: number; receivedQuantity: number }[],
): 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  return lines.every((line) => line.receivedQuantity >= line.orderedQuantity)
    ? 'RECEIVED'
    : 'PARTIALLY_RECEIVED';
}

/**
 * Separation of duties: the person who created or submitted an order cannot approve it, whatever
 * their permissions. The API enforces this; the console uses it to hide the action.
 */
export function canApproveOwnOrder(
  approverUserId: string,
  order: { createdBy: string | null; submittedBy: string | null },
): boolean {
  return approverUserId !== order.createdBy && approverUserId !== order.submittedBy;
}

// ---- money --------------------------------------------------------------------------------------

/**
 * Money is integer minor units everywhere (PostgreSQL bigint, TypeScript number). The limits keep
 * every intermediate value far below Number.MAX_SAFE_INTEGER (9.007e15), so plain integer
 * arithmetic stays exact; line amounts are computed with BigInt anyway so rounding is exact too.
 */
export const MAX_UNIT_COST_MINOR = 10_000_000_000;
export const MAX_LINE_AMOUNT_MINOR = 1_000_000_000_000;
export const MAX_ORDER_AMOUNT_MINOR = 100_000_000_000_000;
export const MAX_SHIPPING_MINOR = 1_000_000_000_000;
export const MAX_PURCHASE_ORDER_LINES = 200;
/** Tax as a rate in basis points: 1500 = 15.00%. */
export const MAX_TAX_RATE_BPS = 10_000;

export interface LineAmounts {
  subtotal: number;
  tax: number;
  total: number;
}

/** quantity × unit cost, tax rounded half-up to the minor unit, computed exactly. */
export function lineAmounts(
  quantity: number,
  unitCostMinor: number,
  taxRateBps: number,
): LineAmounts {
  const subtotal = BigInt(quantity) * BigInt(unitCostMinor);
  const tax = (subtotal * BigInt(taxRateBps) + 5_000n) / 10_000n;
  // Past 2^53 a number is no longer exact; report "too large" rather than a rounded amount.
  if (subtotal + tax > BigInt(Number.MAX_SAFE_INTEGER))
    return { subtotal: Infinity, tax: Infinity, total: Infinity };
  return { subtotal: Number(subtotal), tax: Number(tax), total: Number(subtotal + tax) };
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  shippingCost: number;
  total: number;
}

export function orderTotals(lines: readonly LineAmounts[], shippingCost: number): OrderTotals {
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.subtotal), 0n);
  const tax = lines.reduce((sum, line) => sum + BigInt(line.tax), 0n);
  return {
    subtotal: Number(subtotal),
    tax: Number(tax),
    shippingCost,
    total: Number(subtotal + tax + BigInt(shippingCost)),
  };
}

// ---- numbering ----------------------------------------------------------------------------------

/** PO-2026-000001: year of creation (UTC) and a per-organization, per-year sequence. */
export function formatPurchaseOrderNumber(year: number, sequence: number): string {
  return `PO-${year}-${String(sequence).padStart(6, '0')}`;
}

// ---- requests -----------------------------------------------------------------------------------

const unitCostSchema = z
  .number()
  .int('Use whole minor units (e.g. cents)')
  .min(0)
  .max(MAX_UNIT_COST_MINOR);
const taxRateSchema = z
  .number()
  .int('Use basis points, e.g. 1500 for 15%')
  .min(0)
  .max(MAX_TAX_RATE_BPS);
const orderedQuantitySchema = z
  .number()
  .int('Whole units only')
  .min(1, 'Order at least 1 unit')
  .max(MAX_MOVEMENT_QUANTITY);
const shippingSchema = z
  .number()
  .int('Use whole minor units (e.g. cents)')
  .min(0)
  .max(MAX_SHIPPING_MINOR);
const notesSchema = z.string().trim().max(2000).nullable().optional();
const deliveryDateSchema = z.iso.date('Use a date like 2026-10-15').nullable().optional();
const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date());

export const purchaseOrderLineSchema = z
  .object({
    variantId: z.uuid(),
    quantity: orderedQuantitySchema,
    unitCost: unitCostSchema,
    taxRateBps: taxRateSchema.default(0),
  })
  .refine(
    (line) =>
      lineAmounts(line.quantity, line.unitCost, line.taxRateBps).total <= MAX_LINE_AMOUNT_MINOR,
    { path: ['unitCost'], message: 'This line is too large' },
  );
export type PurchaseOrderLineInput = z.input<typeof purchaseOrderLineSchema>;
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

const uniqueVariants = (lines: readonly { variantId: string }[]) =>
  new Set(lines.map((line) => line.variantId)).size === lines.length;

export const createPurchaseOrderRequestSchema = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  currency: currencySchema,
  expectedDeliveryDate: deliveryDateSchema,
  notes: notesSchema,
  shippingCost: shippingSchema.default(0),
  /** Product ids are derived from the variants on the server; the client never sends them. */
  items: z
    .array(purchaseOrderLineSchema)
    .max(MAX_PURCHASE_ORDER_LINES)
    .refine(uniqueVariants, 'Each variant may appear only once; change its quantity instead')
    .default([]),
});
export type CreatePurchaseOrderRequest = z.input<typeof createPurchaseOrderRequestSchema>;
export type CreatePurchaseOrder = z.infer<typeof createPurchaseOrderRequestSchema>;

/** Draft fields. Once submitted, only `notes` and `expectedDeliveryDate` may still change. */
export const updatePurchaseOrderRequestSchema = z
  .object({
    supplierId: z.uuid(),
    warehouseId: z.uuid(),
    currency: currencySchema,
    expectedDeliveryDate: deliveryDateSchema,
    notes: notesSchema,
    shippingCost: shippingSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdatePurchaseOrderRequest = z.infer<typeof updatePurchaseOrderRequestSchema>;
export const PURCHASE_ORDER_OPEN_FIELDS = ['notes', 'expectedDeliveryDate'] as const;

export const addPurchaseOrderItemRequestSchema = purchaseOrderLineSchema;
export type AddPurchaseOrderItemRequest = PurchaseOrderLineInput;

export const updatePurchaseOrderItemRequestSchema = z
  .object({ quantity: orderedQuantitySchema, unitCost: unitCostSchema, taxRateBps: taxRateSchema })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdatePurchaseOrderItemRequest = z.infer<typeof updatePurchaseOrderItemRequestSchema>;

export const cancelPurchaseOrderRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Say why the order is cancelled').max(500),
});
export type CancelPurchaseOrderRequest = z.infer<typeof cancelPurchaseOrderRequestSchema>;

export const receivePurchaseOrderRequestSchema = z.object({
  lines: z
    .array(
      z.object({
        purchaseOrderItemId: z.uuid(),
        quantity: z
          .number()
          .int('Whole units only')
          .min(1, 'Receive at least 1 unit')
          .max(MAX_MOVEMENT_QUANTITY),
      }),
    )
    .min(1, 'Receive at least one line')
    .max(MAX_PURCHASE_ORDER_LINES)
    .refine(
      (lines) => new Set(lines.map((line) => line.purchaseOrderItemId)).size === lines.length,
      'Each line may appear only once',
    ),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ReceivePurchaseOrderRequest = z.infer<typeof receivePurchaseOrderRequestSchema>;

/**
 * Receipts are retry-safe: the client sends a unique key per receiving attempt, and a retry with
 * the same key returns the original receipt instead of receiving twice.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const idempotencyKeySchema = z
  .string({ error: 'Send an Idempotency-Key header, e.g. a UUID generated for this receipt' })
  .trim()
  .regex(/^[A-Za-z0-9_\-:.]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits or - _ : .');

export const purchaseOrderListQuerySchema = paginationQuerySchema
  .extend({
    /** Matches the PO number or the supplier's name. */
    search: searchTermSchema,
    status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
    supplierId: z.uuid().optional(),
    warehouseId: z.uuid().optional(),
    createdFrom: isoDate.optional(),
    createdTo: isoDate.optional(),
    sort: z.enum(['createdAt', 'number', 'expectedDeliveryDate', 'total']).default('createdAt'),
    direction: sortDirectionSchema.default('desc'),
  })
  .refine(
    (q) => !q.createdFrom || !q.createdTo || new Date(q.createdFrom) <= new Date(q.createdTo),
    { path: ['createdTo'], message: 'createdTo must be after createdFrom' },
  );
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;

// ---- responses ----------------------------------------------------------------------------------

export interface PurchaseOrderSupplier {
  id: string;
  companyName: string;
  status: string;
}

export interface PurchaseOrderWarehouse {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface PurchaseOrderSummary {
  id: string;
  /** The business identifier people use; the UUID is internal. */
  number: string;
  status: PurchaseOrderStatus;
  supplier: PurchaseOrderSupplier;
  warehouse: PurchaseOrderWarehouse;
  currency: string;
  itemCount: number;
  total: number;
  expectedDeliveryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  variantName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  taxRateBps: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface ReceivingSummary {
  orderedUnits: number;
  receivedUnits: number;
  remainingUnits: number;
  receiptCount: number;
  lastReceivedAt: string | null;
}

export interface PurchaseOrderDetail extends PurchaseOrderSummary {
  notes: string | null;
  subtotal: number;
  tax: number;
  shippingCost: number;
  createdBy: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: PurchaseOrderItem[];
  receiving: ReceivingSummary;
}

export interface PurchaseReceiptLine {
  id: string;
  purchaseOrderItemId: string;
  variantId: string;
  sku: string;
  variantName: string;
  quantity: number;
  inventoryMovementId: string;
}

export interface PurchaseReceipt {
  id: string;
  purchaseOrderId: string;
  warehouse: PurchaseOrderWarehouse;
  receivedBy: string | null;
  receivedAt: string;
  note: string | null;
  lines: PurchaseReceiptLine[];
}

export interface PurchaseReceiptResult {
  receipt: PurchaseReceipt;
  purchaseOrder: PurchaseOrderDetail;
  /** True when this response replays an earlier receipt sent with the same Idempotency-Key. */
  replayed: boolean;
}

export interface SupplierPurchasingSummary {
  supplierId: string;
  ordersByStatus: Record<PurchaseOrderStatus, number>;
  /** Value of non-cancelled orders, per currency; currencies are never converted or summed. */
  orderedValue: { currency: string; total: number }[];
  receivedOrders: number;
  /** Fully received orders that had an expected date and arrived on or before it. */
  onTimeOrders: number;
  ordersWithExpectedDate: number;
  /** Mean days from approval to full receipt, over fully received orders. */
  averageLeadTimeDays: number | null;
}
