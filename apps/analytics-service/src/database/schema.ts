import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One row per real send, taken from the dispatcher's `delivery.attempted` events (ADR-0035).
 * Statistics are computed from these rows at query time, so every figure can be checked by hand.
 */
export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    /** The integration event this row came from; the primary key makes redelivery harmless. */
    eventId: uuid('event_id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    endpointId: uuid('endpoint_id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    attempt: integer('attempt').notNull(),
    result: text('result').notNull(),
    statusCode: integer('status_code'),
    errorClass: text('error_class'),
    durationMs: integer('duration_ms').notNull(),
    startedAt: timestamptz('started_at').notNull(),
  },
  (table) => [
    // The same attempt of a delivery is one fact even if two events describe it.
    unique('delivery_attempts_attempt_key').on(
      table.organizationId,
      table.deliveryId,
      table.attempt,
    ),
    index('delivery_attempts_application_idx').on(
      table.organizationId,
      table.applicationId,
      table.startedAt,
    ),
    index('delivery_attempts_endpoint_idx').on(
      table.organizationId,
      table.endpointId,
      table.startedAt,
    ),
    index('delivery_attempts_started_idx').on(table.startedAt),
  ],
);

/** Which events each consumer already applied (ADR-0029). */
export const processedEvents = pgTable(
  'processed_events',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    processedAt: timestamptz('processed_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.consumer, table.eventId] })],
);

export const schema = { deliveryAttempts, processedEvents };
export type AnalyticsSchema = typeof schema;
