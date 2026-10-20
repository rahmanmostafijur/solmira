import type { EventEnvelope } from '@solmira/contracts';
import type { ConfirmChannel } from 'amqplib';
import type pg from 'pg';
import { EVENTS_EXCHANGE } from './topology.js';

interface OutboxRow {
  id: string;
  type: string;
  version: number;
  occurred_at: Date;
  organization_id: string | null;
  actor_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  payload: unknown;
}

export function toEnvelope(row: OutboxRow): EventEnvelope {
  return {
    eventId: row.id,
    type: row.type,
    version: row.version,
    occurredAt: row.occurred_at.toISOString(),
    organizationId: row.organization_id,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
  };
}

export interface RelayBatch {
  readonly published: number;
}

/**
 * One relay pass (ADR-0029): claim unpublished rows with FOR UPDATE SKIP LOCKED, publish them on a
 * confirm channel, mark them published, commit. A crash before the commit leaves the rows
 * unpublished (they are claimed again); a crash after publishing but before the commit publishes
 * them twice. Consumers are idempotent, so the second case is harmless.
 */
export async function relayOutboxBatch(
  pool: pg.Pool,
  channel: ConfirmChannel,
  batchSize: number,
  table = 'outbox_events',
): Promise<RelayBatch> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<OutboxRow>(
      `select id, type, version, occurred_at, organization_id, actor_id, correlation_id,
              causation_id, payload
         from ${table}
        where published_at is null
        order by occurred_at, id
        limit $1
        for update skip locked`,
      [batchSize],
    );
    if (rows.length === 0) {
      await client.query('commit');
      return { published: 0 };
    }
    for (const row of rows) {
      const envelope = toEnvelope(row);
      channel.publish(EVENTS_EXCHANGE, row.type, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
        messageId: row.id,
        type: row.type,
        contentType: 'application/json',
        timestamp: Math.floor(row.occurred_at.getTime() / 1000),
        headers: { 'x-correlation-id': row.correlation_id },
      });
    }
    await channel.waitForConfirms();
    await client.query(`update ${table} set published_at = now() where id = any($1::uuid[])`, [
      rows.map((row) => row.id),
    ]);
    await client.query('commit');
    return { published: rows.length };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
