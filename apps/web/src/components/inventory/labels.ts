import type {
  AdjustmentReason,
  InventoryMovementType,
  ReservationStatus,
} from '@solmira/contracts';
import type { BadgeTone } from '@/components/ui/badge';

interface StatusLabel {
  readonly label: string;
  readonly tone: BadgeTone;
}

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  ADJUSTMENT: 'Adjustment',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  RESERVATION: 'Reserved',
  RELEASE: 'Released',
};

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  RECEIVED: 'Received',
  COUNT: 'Stock count',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  FOUND: 'Found',
  RETURNED: 'Returned',
  CORRECTION: 'Correction',
};

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, StatusLabel> = {
  ACTIVE: { label: 'Active', tone: 'accent' },
  RELEASED: { label: 'Released', tone: 'neutral' },
};

/** The typographic minus: the same width as "+", so signed columns line up. */
export const MINUS_SIGN = '−';

/** A signed quantity for the ledger: "+5", "−2", or "0" for no change. */
export function formatQuantityChange(change: number): string {
  if (change > 0) return `+${change.toLocaleString('en')}`;
  if (change < 0) return `${MINUS_SIGN}${Math.abs(change).toLocaleString('en')}`;
  return '0';
}

/** Text color of a signed quantity: gains green, losses red, no change muted. */
export function quantityChangeClass(change: number): string {
  if (change > 0) return 'text-ok';
  if (change < 0) return 'text-danger';
  return 'text-ink-muted';
}
