import type { DeliverySummary } from '@solmira/contracts';
import { sql } from 'drizzle-orm';

export interface MessageRow extends Record<string, unknown> {
  id: string;
  application_id: string;
  event_type: string;
  created_at: Date | string;
  payload_bytes: number;
  pending: number;
  in_progress: number;
  succeeded: number;
  failed: number;
}

export interface DeliveryRow extends Record<string, unknown> {
  id: string;
  message_id: string;
  endpoint_id: string;
  endpoint_url: string;
  event_type: string;
  status: DeliverySummary['status'];
  attempt_count: number;
  next_attempt_at: Date | string;
  last_attempt_at: Date | string | null;
  last_status_code: number | null;
  last_error_class: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

/** Raw SQL rows may carry timestamps as strings or dates; both become ISO strings. */
export const iso = (value: Date | string): string => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value);

export const toDelivery = (row: DeliveryRow): DeliverySummary => ({
  id: row.id,
  messageId: row.message_id,
  endpointId: row.endpoint_id,
  endpointUrl: row.endpoint_url,
  eventType: row.event_type,
  status: row.status,
  attemptCount: row.attempt_count,
  nextAttemptAt: iso(row.next_attempt_at),
  lastAttemptAt: isoOrNull(row.last_attempt_at),
  lastStatusCode: row.last_status_code,
  lastErrorClass: row.last_error_class,
  completedAt: isoOrNull(row.completed_at),
  createdAt: iso(row.created_at),
});

/** The delivery columns every inspection query selects (joined with endpoint, message, event type). */
export const DELIVERY_COLUMNS = sql`
  d.id, d.message_id, d.endpoint_id, e.url as endpoint_url, t.name as event_type, d.status,
  d.attempt_count, d.next_attempt_at, d.last_attempt_at, d.last_status_code, d.last_error_class,
  d.completed_at, d.created_at`;
