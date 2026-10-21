import type { DeliveryAttemptResult } from '@solmira/contracts';
import type pg from 'pg';
import type { ClaimedDelivery, Outcome, SentAttempt } from './delivery-repository.js';

type Queryable = Pick<pg.PoolClient, 'query'>;

const RESULT_OF: Record<Outcome['kind'], DeliveryAttemptResult> = {
  succeeded: 'succeeded',
  retry: 'retrying',
  failed: 'failed',
};

/**
 * Adds the `delivery.attempted` event to the outbox (ADR-0035) from the delivery's own rows, inside
 * the tenant transaction that records the outcome. Analytics and the realtime feed read it. It holds
 * ids, the event type name, the result and timings; never the URL, headers, payload or response.
 */
export async function recordAttemptEvent(
  db: Queryable,
  claimed: ClaimedDelivery,
  outcome: Outcome,
  sent: SentAttempt,
): Promise<void> {
  await db.query(
    `insert into outbox_events (id, type, version, occurred_at, organization_id, actor_id, correlation_id, payload)
     select uuidv7(), 'delivery.attempted', 1, now(), d.organization_id, null, 'dispatcher',
            jsonb_build_object(
              'deliveryId', d.id, 'messageId', d.message_id, 'endpointId', d.endpoint_id,
              'applicationId', d.application_id, 'eventType', et.name,
              'attempt', $2::int, 'result', $3::text, 'statusCode', $4::int,
              'errorClass', $5::text, 'durationMs', $6::int, 'startedAt', $7::text,
              'nextAttemptAt', $8::text)
       from deliveries d
       join messages m on m.id = d.message_id and m.organization_id = d.organization_id
       join event_types et on et.id = m.event_type_id and et.organization_id = m.organization_id
      where d.id = $1 and d.organization_id = $9`,
    [
      claimed.deliveryId,
      claimed.attempt,
      RESULT_OF[outcome.kind],
      outcome.statusCode,
      outcome.kind === 'succeeded' ? null : outcome.errorClass,
      sent.durationMs,
      sent.startedAt.toISOString(),
      outcome.kind === 'retry' ? outcome.at.toISOString() : null,
      claimed.organizationId,
    ],
  );
}
