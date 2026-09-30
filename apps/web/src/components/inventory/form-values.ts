import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_REASONS,
  MAX_MOVEMENT_QUANTITY,
  MAX_STOCK_QUANTITY,
  adjustmentIssue,
  type AdjustStockRequest,
  type AdjustmentReason,
} from '@solmira/contracts';
import { z } from 'zod';
import { MINUS_SIGN } from './labels';

/**
 * Quantities are typed as text and checked with the API's own rules (adjustmentIssue, the same
 * bounds), so a request the form lets through is one the server accepts unless stock moved.
 */

const count = (n: number) => n.toLocaleString('en');

/** Whole units as typed ("5", "+5", "-2", "−2"), or null when the text is not a whole number. */
export function parseUnits(text: string, signed = false): number | null {
  const value = text.trim().replace(MINUS_SIGN, '-');
  if (!(signed ? /^[+-]?\d+$/ : /^\d+$/).test(value)) return null;
  const units = Number(value);
  return Number.isSafeInteger(units) ? units : null;
}

const note = z.string().trim().max(500, 'At most 500 characters');
/** A blank note is left out of the request rather than sent. */
export const noteOrOmitted = (value: string) => (value === '' ? {} : { note: value });

/** A positive quantity up to `max`; `maxMessage` explains the ceiling (e.g. what is available). */
const unitsField = (max: number, maxMessage: string) =>
  z
    .string()
    .trim()
    .superRefine((text, ctx) => {
      const units = parseUnits(text);
      if (units === null || units < 1) {
        ctx.addIssue({ code: 'custom', message: 'Enter at least 1 whole unit' });
      } else if (units > max) {
        ctx.addIssue({ code: 'custom', message: maxMessage });
      }
    });

/** The most a move out of stock may take: what is available, within the per-movement cap. */
function movableUnits(available: number) {
  const max = Math.max(0, Math.min(available, MAX_MOVEMENT_QUANTITY));
  const message =
    available <= MAX_MOVEMENT_QUANTITY
      ? `Only ${count(Math.max(0, available))} available`
      : `At most ${count(MAX_MOVEMENT_QUANTITY)} units at a time`;
  return unitsField(max, message);
}

// ---- adjustments --------------------------------------------------------------------------------

export const DIRECTION_HINTS: Record<(typeof ADJUSTMENT_DIRECTIONS)[AdjustmentReason], string> = {
  increase: 'Units added, e.g. 5',
  decrease: `Units removed, as a negative number, e.g. ${MINUS_SIGN}2`,
  any: `Positive adds stock, negative removes it, e.g. 3 or ${MINUS_SIGN}2`,
};

function adjustQuantityIssue(reason: AdjustmentReason, text: string): string | null {
  const counting = reason === 'COUNT';
  const units = parseUnits(text, !counting);
  if (units === null) {
    return counting
      ? 'Enter the whole number of units counted'
      : `Enter whole units, e.g. 5 or ${MINUS_SIGN}2`;
  }
  if (counting && units > MAX_STOCK_QUANTITY) return `At most ${count(MAX_STOCK_QUANTITY)}`;
  if (!counting && Math.abs(units) > MAX_MOVEMENT_QUANTITY) {
    return `At most ${count(MAX_MOVEMENT_QUANTITY)} units at a time`;
  }
  const issue = adjustmentIssue(
    counting ? { reason, countedQuantity: units } : { reason, quantityChange: units },
  );
  return issue?.message ?? null;
}

export const adjustFormSchema = z
  .object({
    reason: z.enum(ADJUSTMENT_REASONS),
    quantity: z.string().trim(),
    note,
  })
  .superRefine((values, ctx) => {
    const message = adjustQuantityIssue(values.reason, values.quantity);
    if (message) ctx.addIssue({ code: 'custom', path: ['quantity'], message });
  });

export type AdjustFormInput = z.input<typeof adjustFormSchema>;
export type AdjustFormValues = z.output<typeof adjustFormSchema>;

export interface StockTarget {
  readonly warehouseId: string;
  readonly variantId: string;
}

export function toAdjustRequest(values: AdjustFormValues, target: StockTarget): AdjustStockRequest {
  const counting = values.reason === 'COUNT';
  const units = parseUnits(values.quantity, !counting) ?? 0;
  return {
    warehouseId: target.warehouseId,
    variantId: target.variantId,
    reason: values.reason,
    ...(counting ? { countedQuantity: units } : { quantityChange: units }),
    ...noteOrOmitted(values.note),
  };
}

/** On hand after the adjustment as typed so far, or null while the quantity is not a number. */
export function onHandAfter(reason: AdjustmentReason, text: string, onHand: number): number | null {
  const units = parseUnits(text, reason !== 'COUNT');
  if (units === null) return null;
  return reason === 'COUNT' ? units : onHand + units;
}

/** Both server paths of the quantity (a change or a count) are shown on the one input. */
export const adjustFieldFor = (path: string) =>
  path === 'quantityChange' || path === 'countedQuantity'
    ? 'quantity'
    : path === 'reason' || path === 'note'
      ? path
      : '';

// ---- transfers and reservations -----------------------------------------------------------------

export function transferFormSchema(available: number) {
  return z.object({
    toWarehouseId: z.string().min(1, 'Choose a destination warehouse'),
    quantity: movableUnits(available),
    note,
  });
}

export type TransferFormInput = z.input<ReturnType<typeof transferFormSchema>>;
export type TransferFormValues = z.output<ReturnType<typeof transferFormSchema>>;

export function reserveFormSchema(available: number) {
  return z.object({
    quantity: movableUnits(available),
    reference: z
      .string()
      .trim()
      .min(1, 'Say what the stock is held for')
      .max(100, 'At most 100 characters'),
    note,
  });
}

export type ReserveFormInput = z.input<ReturnType<typeof reserveFormSchema>>;
export type ReserveFormValues = z.output<ReturnType<typeof reserveFormSchema>>;

/** A one-line reservation reports its quantity as `lines.0.quantity`. */
export const reserveFieldFor = (path: string) =>
  path.startsWith('lines.') && path.endsWith('.quantity')
    ? 'quantity'
    : path === 'reference' || path === 'note'
      ? path
      : '';

// ---- reorder point ------------------------------------------------------------------------------

export const reorderFormSchema = z.object({
  reorderPoint: z
    .string()
    .trim()
    .refine((text) => {
      if (text === '') return true;
      const units = parseUnits(text);
      return units !== null && units <= MAX_STOCK_QUANTITY;
    }, 'A whole number of units, or empty to switch low-stock alerts off'),
});

export type ReorderFormInput = z.input<typeof reorderFormSchema>;
export type ReorderFormValues = z.output<typeof reorderFormSchema>;

export const toReorderPoint = (values: ReorderFormValues): number | null =>
  values.reorderPoint === '' ? null : parseUnits(values.reorderPoint);

// ---- new stock line -----------------------------------------------------------------------------

export const addStockFormSchema = z.object({
  productId: z.string().min(1, 'Choose a product'),
  variantId: z.string().min(1, 'Choose a variant'),
  warehouseId: z.string().min(1, 'Choose a warehouse'),
  quantity: unitsField(
    MAX_MOVEMENT_QUANTITY,
    `At most ${count(MAX_MOVEMENT_QUANTITY)} units at a time`,
  ),
  note,
});

export type AddStockFormInput = z.input<typeof addStockFormSchema>;
export type AddStockFormValues = z.output<typeof addStockFormSchema>;

/** Stock arriving for a variant is recorded as a receipt, like any other goods in. */
export const toReceiptRequest = (values: AddStockFormValues): AdjustStockRequest => ({
  warehouseId: values.warehouseId,
  variantId: values.variantId,
  reason: 'RECEIVED',
  quantityChange: parseUnits(values.quantity) ?? 0,
  ...noteOrOmitted(values.note),
});

export const addStockFieldFor = (path: string) =>
  path === 'quantityChange'
    ? 'quantity'
    : path === 'warehouseId' || path === 'variantId' || path === 'note'
      ? path
      : '';
