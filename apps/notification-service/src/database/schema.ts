import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** An in-app notification for an organization. One row per source event, however often it arrives. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    /** The integration event that caused it; unique, so the same event never notifies twice. */
    sourceEventId: uuid('source_event_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Ids needed to act on it (endpoint, application), never secrets or URLs. */
    data: jsonb('data').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    readAt: timestamptz('read_at'),
  },
  (table) => [
    unique('notifications_source_event_key').on(table.sourceEventId),
    index('notifications_org_created_idx').on(table.organizationId, table.createdAt.desc()),
    index('notifications_org_unread_idx')
      .on(table.organizationId, table.createdAt.desc())
      .where(sql`${table.readAt} is null`),
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

export const schema = { notifications, processedEvents };
export type NotificationSchema = typeof schema;
