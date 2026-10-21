import { Inject, Injectable } from '@nestjs/common';
import type { ReplayEndpointRequest, ReplayResult } from '@solmira/contracts';
import { ConflictError, NotFoundError, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { findApplication } from '../applications/applications.service.js';
import { Database, type IngestTransaction } from '../database/database.module.js';
import { endpoints, messages } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';

/**
 * Puts deliveries back in the queue (ADR-0033). Replay starts a new cycle: `attempt_count` keeps
 * counting, so every attempt keeps a unique key in the history, and `cycle_base` records where the
 * cycle began so the retry schedule starts over. Only deliveries that are not already waiting are
 * touched, which makes repeating a replay harmless.
 */
@Injectable()
export class ReplayService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** Replays a message's deliveries (finished ones), all of them or the one to `endpointId`. */
  replayMessage(
    auth: TenantAuthContext,
    applicationId: string,
    messageId: string,
    endpointId: string | undefined,
  ): Promise<ReplayResult> {
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      const [message] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, auth.organizationId),
            eq(messages.applicationId, applicationId),
            eq(messages.id, messageId),
          ),
        );
      if (!message) throw new NotFoundError('Message not found');
      if (endpointId) await this.assertReplayable(tx, auth, applicationId, endpointId);

      const result = await tx.execute(sql`
        update deliveries d
           set status = 'pending', cycle_base = d.attempt_count, next_attempt_at = now(),
               locked_until = null, completed_at = null, updated_at = now()
          from endpoints e
         where d.organization_id = ${auth.organizationId} and d.message_id = ${messageId}
           and d.status in ('failed', 'succeeded')
           and e.organization_id = d.organization_id and e.id = d.endpoint_id
           and e.archived_at is null and e.enabled
           and (${endpointId ?? null}::uuid is null or d.endpoint_id = ${endpointId ?? null}::uuid)
      `);
      const replayed = result.rowCount ?? 0;
      if (replayed > 0)
        await recordEvent(tx, auth, 'delivery.replayed', {
          applicationId,
          messageId,
          endpointId: endpointId ?? null,
          deliveries: replayed,
        });
      return { replayed, more: false };
    });
  }

  /** Replays an endpoint's failed deliveries for messages created in `[from, to)`, in bounded batches. */
  replayEndpoint(
    auth: TenantAuthContext,
    applicationId: string,
    endpointId: string,
    range: ReplayEndpointRequest,
  ): Promise<ReplayResult> {
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      await this.assertReplayable(tx, auth, applicationId, endpointId);
      const result = await tx.execute(sql`
        with candidates as (
          select d.id
            from deliveries d
            join messages m on m.organization_id = d.organization_id and m.id = d.message_id
           where d.organization_id = ${auth.organizationId} and d.endpoint_id = ${endpointId}
             and d.status = 'failed'
             and m.created_at >= ${range.from}::timestamptz and m.created_at < ${range.to}::timestamptz
           order by m.created_at, d.id
           limit ${range.limit + 1}
        ), chosen as (
          select id from candidates order by id limit ${range.limit}
        ), updated as (
          update deliveries d
             set status = 'pending', cycle_base = d.attempt_count, next_attempt_at = now(),
                 locked_until = null, completed_at = null, updated_at = now()
            from chosen
           where d.id = chosen.id and d.status = 'failed'
          returning d.id
        )
        select (select count(*) from updated)::int as replayed,
               (select count(*) from candidates)::int as found
      `);
      const row = result.rows[0] as { replayed: number; found: number } | undefined;
      const replayed = row?.replayed ?? 0;
      if (replayed > 0)
        await recordEvent(tx, auth, 'delivery.replayed', {
          applicationId,
          messageId: null,
          endpointId,
          deliveries: replayed,
        });
      return { replayed, more: (row?.found ?? 0) > range.limit };
    });
  }

  /** A disabled endpoint would only fail the replay again; the owner has to enable it first. */
  private async assertReplayable(
    tx: IngestTransaction,
    auth: TenantAuthContext,
    applicationId: string,
    endpointId: string,
  ): Promise<void> {
    const [endpoint] = await tx
      .select({ enabled: endpoints.enabled })
      .from(endpoints)
      .where(
        and(
          eq(endpoints.organizationId, auth.organizationId),
          eq(endpoints.applicationId, applicationId),
          eq(endpoints.id, endpointId),
          isNull(endpoints.archivedAt),
        ),
      );
    if (!endpoint) throw new NotFoundError('Endpoint not found');
    if (!endpoint.enabled)
      throw new ConflictError('The endpoint is disabled; enable it before replaying');
  }
}
