import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AttemptStore } from '@solmira/attempt-history';
import type {
  AttemptView,
  DeliveryListQuery,
  MessageDetail,
  MessageListQuery,
  MessageSummary,
} from '@solmira/contracts';
import { NotFoundError, offsetOf, pageOf, type TenantAuthContext } from '@solmira/service-kit';
import { sql } from 'drizzle-orm';
import { findApplication } from '../applications/applications.service.js';
import { Database } from '../database/database.module.js';
import { findEndpoint } from '../endpoints/endpoint-views.js';
import { ATTEMPT_STORE } from '../ingest.tokens.js';
import { DELIVERY_COLUMNS, iso, toDelivery, type DeliveryRow, type MessageRow } from './rows.js';

type MessageDetailRow = MessageRow & { payload: Record<string, unknown>; idempotency_key: string };

/** Read side of messages and deliveries for the console. */
@Injectable()
export class InspectionService {
  private readonly logger = new Logger('Inspection');

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ATTEMPT_STORE) private readonly attempts: AttemptStore,
  ) {}

  listMessages(auth: TenantAuthContext, applicationId: string, query: MessageListQuery) {
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId, { includeArchived: true });
      const type = query.eventType ?? null;
      const from = query.from ?? null;
      const to = query.to ?? null;
      const filters = sql`m.organization_id = ${auth.organizationId} and m.application_id = ${applicationId}
        and (${type}::text is null or t.name = ${type})
        and (${from}::timestamptz is null or m.created_at >= ${from}::timestamptz)
        and (${to}::timestamptz is null or m.created_at < ${to}::timestamptz)`;
      const total = await tx.execute(sql`
        select count(*)::int as n from messages m
          join event_types t on t.organization_id = m.organization_id and t.id = m.event_type_id
         where ${filters}`);
      const rows = await tx.execute<MessageRow>(sql`
        select m.id, m.application_id, t.name as event_type, m.created_at, m.payload_bytes,
               count(d.id) filter (where d.status = 'pending')::int as pending,
               count(d.id) filter (where d.status = 'in_progress')::int as in_progress,
               count(d.id) filter (where d.status = 'succeeded')::int as succeeded,
               count(d.id) filter (where d.status = 'failed')::int as failed
          from messages m
          join event_types t on t.organization_id = m.organization_id and t.id = m.event_type_id
          left join deliveries d on d.organization_id = m.organization_id and d.message_id = m.id
         where ${filters}
         group by m.id, t.name
         order by m.created_at desc, m.id desc
         limit ${query.pageSize} offset ${offsetOf(query)}`);
      const items: MessageSummary[] = rows.rows.map((row) => ({
        id: row.id,
        applicationId: row.application_id,
        eventType: row.event_type,
        createdAt: iso(row.created_at),
        payloadBytes: row.payload_bytes,
        deliveries: {
          pending: row.pending,
          in_progress: row.in_progress,
          succeeded: row.succeeded,
          failed: row.failed,
        },
      }));
      return pageOf(items, (total.rows[0] as { n: number }).n, query);
    });
  }

  async getMessage(
    auth: TenantAuthContext,
    applicationId: string,
    messageId: string,
  ): Promise<MessageDetail> {
    const loaded = await this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId, { includeArchived: true });
      const found = await tx.execute<MessageDetailRow>(sql`
        select m.id, m.application_id, t.name as event_type, m.created_at, m.payload_bytes,
               m.payload, m.idempotency_key
          from messages m
          join event_types t on t.organization_id = m.organization_id and t.id = m.event_type_id
         where m.organization_id = ${auth.organizationId}
           and m.application_id = ${applicationId} and m.id = ${messageId}`);
      const row = found.rows[0];
      if (!row) throw new NotFoundError('Message not found');
      const deliveries = await tx.execute<DeliveryRow>(sql`
        select ${DELIVERY_COLUMNS}
          from deliveries d
          join endpoints e on e.organization_id = d.organization_id and e.id = d.endpoint_id
          join messages m on m.organization_id = d.organization_id and m.id = d.message_id
          join event_types t on t.organization_id = m.organization_id and t.id = m.event_type_id
         where d.organization_id = ${auth.organizationId} and d.message_id = ${messageId}
         order by d.created_at, d.id`);
      return { row, deliveries: deliveries.rows.map(toDelivery) };
    });
    const history = await this.attemptsOf(auth.organizationId, messageId);
    return {
      id: loaded.row.id,
      applicationId: loaded.row.application_id,
      eventType: loaded.row.event_type,
      createdAt: iso(loaded.row.created_at),
      payloadBytes: loaded.row.payload_bytes,
      payload: loaded.row.payload,
      idempotencyKey: loaded.row.idempotency_key,
      deliveries: loaded.deliveries,
      attempts: history.attempts,
      attemptsAvailable: history.available,
    };
  }

  listEndpointDeliveries(
    auth: TenantAuthContext,
    applicationId: string,
    endpointId: string,
    query: DeliveryListQuery,
  ) {
    return this.database.forTenant(auth, async (tx) => {
      await findEndpoint(tx, auth, applicationId, endpointId);
      const status = query.status ?? null;
      const filter = sql`d.organization_id = ${auth.organizationId} and d.endpoint_id = ${endpointId}
        and (${status}::text is null or d.status = ${status})`;
      const total = await tx.execute(
        sql`select count(*)::int as n from deliveries d where ${filter}`,
      );
      const rows = await tx.execute<DeliveryRow>(sql`
        select ${DELIVERY_COLUMNS}
          from deliveries d
          join endpoints e on e.organization_id = d.organization_id and e.id = d.endpoint_id
          join messages m on m.organization_id = d.organization_id and m.id = d.message_id
          join event_types t on t.organization_id = m.organization_id and t.id = m.event_type_id
         where ${filter}
         order by d.created_at desc, d.id desc
         limit ${query.pageSize} offset ${offsetOf(query)}`);
      return pageOf(rows.rows.map(toDelivery), (total.rows[0] as { n: number }).n, query);
    });
  }

  /** The history is derived data: if it cannot be read, the page still shows the deliveries. */
  private async attemptsOf(organizationId: string, messageId: string) {
    try {
      const stored = await this.attempts.listForMessage(organizationId, messageId);
      const attempts: AttemptView[] = stored
        .map((item) => ({
          deliveryId: item.deliveryId,
          endpointId: item.endpointId,
          attempt: item.attempt,
          startedAt: item.startedAt,
          durationMs: item.durationMs,
          statusCode: item.statusCode,
          errorClass: item.errorClass,
          responseBody: item.responseBody,
          responseBodyTruncated: item.responseBodyTruncated,
          nextAttemptAt: item.nextAttemptAt,
        }))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      return { attempts, available: true };
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not read the attempt history');
      return { attempts: [] as AttemptView[], available: false };
    }
  }
}
