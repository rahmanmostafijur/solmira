import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ConfirmChannel } from 'amqplib';
import amqp from 'amqplib';
import type pg from 'pg';
import { createServiceApp } from '../src/bootstrap.js';
import type { EventConsumerDefinition } from '../src/messaging/event-consumer.js';
import { BackboneProbeModule } from './backbone.module.js';

export const env = {
  postgres:
    process.env.TEST_DATABASE_URL ??
    'postgres://solmira:solmira_dev_password@localhost:5433/postgres',
  redis: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
  rabbitmq: process.env.TEST_RABBITMQ_URL ?? 'amqp://solmira:solmira_dev_password@localhost:5672',
};

export const uniqueName = (prefix: string) => prefix + '.' + randomUUID().slice(0, 8);

export async function startBackbone(
  definitions: readonly EventConsumerDefinition[],
  relay: { batchSize: number; pollIntervalMs: number } | null,
  metrics?: { enabled: boolean; write: (line: string) => void },
): Promise<NestExpressApplication> {
  const app = await createServiceApp(
    BackboneProbeModule.register(
      {
        serviceName: 'backbone-probe',
        logging: { level: 'silent', pretty: false },
        postgres: { url: env.postgres, poolMax: 4 },
        rabbitmq: { url: env.rabbitmq },
        ...(metrics ? { metrics } : {}),
      },
      definitions,
      relay,
    ),
    { serviceName: 'backbone-probe', nodeEnv: 'test' },
  );
  await app.init();
  return app;
}

export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for a condition');
}

/** A side connection for assertions on queues and for publishing by hand. */
export async function openBroker() {
  const connection = await amqp.connect(env.rabbitmq);
  const channel: ConfirmChannel = await connection.createConfirmChannel();
  return { connection, channel, close: () => connection.close() };
}

export async function createOutboxTable(pool: pg.Pool, table: string) {
  await pool.query(
    'create table if not exists ' +
      table +
      ` (id uuid primary key, type text not null, version int not null,
         occurred_at timestamptz not null, organization_id uuid, actor_id uuid,
         correlation_id text not null, causation_id uuid, payload jsonb not null,
         published_at timestamptz)`,
  );
}

export async function addOutboxEvent(pool: pg.Pool, table: string, type: string): Promise<string> {
  const id: string = randomUUID();
  await pool.query(
    'insert into ' +
      table +
      ` (id, type, version, occurred_at, correlation_id, payload)
       values ($1, $2, 1, now(), 'corr-1', '{"n":1}')`,
    [id, type],
  );
  return id;
}

/** Checks on a throwaway channel: a missing queue closes the channel that asked. */
export async function queueExists(
  connection: Awaited<ReturnType<typeof openBroker>>['connection'],
  name: string,
): Promise<boolean> {
  const channel = await connection.createChannel();
  channel.on('error', () => undefined);
  try {
    await channel.checkQueue(name);
    return true;
  } catch {
    return false;
  } finally {
    await channel.close().catch(() => undefined);
  }
}

/**
 * True once a consumer is attached to the queue. A queue exists before it is bound and consumed, and
 * a message published in between has nowhere to go, so tests wait for this before they publish.
 */
export async function hasConsumer(
  connection: Awaited<ReturnType<typeof openBroker>>['connection'],
  name: string,
): Promise<boolean> {
  const channel = await connection.createChannel();
  channel.on('error', () => undefined);
  try {
    return (await channel.checkQueue(name)).consumerCount > 0;
  } catch {
    return false;
  } finally {
    await channel.close().catch(() => undefined);
  }
}
