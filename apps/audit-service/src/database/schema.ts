import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One row per administrative action (ADR-0036). Append-only: the database refuses updates and
 * deletes by the runtime role, and only the retention job removes old rows.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    /** The integration event this record came from; unique, so a redelivered event adds nothing. */
    eventId: uuid('event_id').notNull().unique('audit_logs_event_key'),
    organizationId: uuid('organization_id').notNull(),
    action: text('action').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    occurredAt: timestamptz('occurred_at').notNull(),
    correlationId: text('correlation_id').notNull(),
    details: jsonb('details').notNull(),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_org_time_idx').on(table.organizationId, table.occurredAt.desc()),
    index('audit_logs_org_action_idx').on(
      table.organizationId,
      table.action,
      table.occurredAt.desc(),
    ),
    index('audit_logs_org_target_idx').on(table.organizationId, table.targetType, table.targetId),
    index('audit_logs_org_actor_idx').on(
      table.organizationId,
      table.actorId,
      table.occurredAt.desc(),
    ),
    index('audit_logs_time_idx').on(table.occurredAt),
  ],
);

export const schema = { auditLogs };
export type AuditSchema = typeof schema;
