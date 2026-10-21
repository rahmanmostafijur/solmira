import { Inject, Injectable } from '@nestjs/common';
import type { AuditLogQuery, AuditRecord, EventEnvelope, Page } from '@solmira/contracts';
import { offsetOf, pageOf, type TenantAuthContext } from '@solmira/service-kit';
import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Database } from '../database/database.module.js';
import { auditLogs } from '../database/schema.js';
import { toAuditRecord } from './audit-record.js';

export const ADMIN_ACTIONS_CONSUMER = 'audit.admin-actions';

type Row = typeof auditLogs.$inferSelect;

const toView = (row: Row): AuditRecord => ({
  id: row.id,
  action: row.action,
  actorType: row.actorType as AuditRecord['actorType'],
  actorId: row.actorId,
  targetType: row.targetType as AuditRecord['targetType'],
  targetId: row.targetId,
  occurredAt: row.occurredAt.toISOString(),
  correlationId: row.correlationId,
  details: row.details as Record<string, unknown>,
});

@Injectable()
export class AuditService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** Idempotent: the event id is unique, so an event delivered twice is recorded once. */
  async record(event: EventEnvelope): Promise<void> {
    const record = toAuditRecord(event);
    if (!record) return;
    await this.database.forTenant(
      { organizationId: record.organizationId, userId: null },
      async (tx) => {
        await tx
          .insert(auditLogs)
          .values({ id: uuidv7(), ...record })
          .onConflictDoNothing({ target: auditLogs.eventId });
      },
    );
  }

  /** Newest first. The organization is filtered here as well as by Row Level Security. */
  list(auth: TenantAuthContext, query: AuditLogQuery): Promise<Page<AuditRecord>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(auditLogs.organizationId, auth.organizationId),
        query.action ? eq(auditLogs.action, query.action) : undefined,
        query.actorId ? eq(auditLogs.actorId, query.actorId) : undefined,
        query.targetType ? eq(auditLogs.targetType, query.targetType) : undefined,
        query.targetId ? eq(auditLogs.targetId, query.targetId) : undefined,
        query.from ? gte(auditLogs.occurredAt, new Date(query.from)) : undefined,
        query.to ? lt(auditLogs.occurredAt, new Date(query.to)) : undefined,
      );
      const [{ total = 0 } = {}] = await tx.select({ total: count() }).from(auditLogs).where(where);
      const rows = await tx
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      return pageOf(rows.map(toView), total, query);
    });
  }
}
