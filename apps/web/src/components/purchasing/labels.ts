import {
  isPurchaseOrderOpen,
  type PurchaseOrderStatus,
  type ReceivingSummary,
  type SupplierPurchasingSummary,
} from '@solmira/contracts';
import type { BadgeTone } from '@/components/ui/badge';

interface StatusLabel {
  readonly label: string;
  readonly tone: BadgeTone;
}

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, StatusLabel> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Awaiting approval', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'accent' },
  PARTIALLY_RECEIVED: { label: 'Partially received', tone: 'accent' },
  RECEIVED: { label: 'Received', tone: 'ok' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

export const formatUnits = (n: number) => n.toLocaleString('en');

/**
 * An expected delivery date is a calendar day ("2026-10-15"), not an instant: it is formatted in
 * UTC so it reads as the same day in every time zone.
 */
export function formatDeliveryDate(date: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date.slice(0, 10)}T00:00:00Z`),
  );
}

/** Today as a calendar day in the viewer's time zone, e.g. "2026-10-01". */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** An open order whose expected day has passed. Drafts have not been sent yet, so never late. */
export function isDeliveryOverdue(
  expectedDeliveryDate: string | null,
  status: PurchaseOrderStatus,
  today: string,
): boolean {
  if (!expectedDeliveryDate || status === 'DRAFT' || !isPurchaseOrderOpen(status)) return false;
  return expectedDeliveryDate.slice(0, 10) < today;
}

/** 1500 -> "15%", 725 -> "7.25%", 0 -> "0%". */
export function formatTaxRate(bps: number): string {
  return `${(bps / 100).toLocaleString('en', { maximumFractionDigits: 2 })}%`;
}

/** Share of ordered units received so far, 0-100, rounded down so 100% means everything. */
export function receivedPercent(
  receiving: Pick<ReceivingSummary, 'orderedUnits' | 'receivedUnits'>,
) {
  if (receiving.orderedUnits <= 0) return 0;
  return Math.min(100, Math.floor((receiving.receivedUnits / receiving.orderedUnits) * 100));
}

/** On-time share (0-100) of received orders that had an expected date, or null without any. */
export function onTimeRate(
  summary: Pick<SupplierPurchasingSummary, 'onTimeOrders' | 'ordersWithExpectedDate'>,
): number | null {
  return summary.ordersWithExpectedDate > 0
    ? Math.round((summary.onTimeOrders / summary.ordersWithExpectedDate) * 100)
    : null;
}

const FIELD_NAMES: Record<string, string> = {
  supplierId: 'Supplier',
  warehouseId: 'Warehouse',
  currency: 'Currency',
  expectedDeliveryDate: 'Expected delivery',
  notes: 'Notes',
  shippingCost: 'Shipping',
  items: 'Lines',
};

/**
 * Where a server issue points, in words: "items.2.variantId" becomes "Line 3 (SKU-1)", so a
 * refused submission can say which line to fix.
 */
export function describeIssuePath(path: string, items: readonly { sku: string }[] = []): string {
  const line = /^items\.(\d+)(\.|$)/.exec(path);
  if (line) {
    const index = Number(line[1]);
    const sku = items[index]?.sku;
    return sku ? `Line ${index + 1} (${sku})` : `Line ${index + 1}`;
  }
  return FIELD_NAMES[path] ?? path;
}
