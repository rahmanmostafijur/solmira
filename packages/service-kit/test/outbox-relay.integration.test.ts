import type { EventEnvelope } from '@solmira/contracts';
import type { ConfirmChannel } from 'amqplib';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayOutboxBatch } from '../src/messaging/outbox-relay.js';
import {
  addOutboxEvent,
  createOutboxTable,
  env,
  openBroker,
  queueExists,
  startBackbone,
  uniqueName,
  until,
} from './support-backbone.js';

const pool = new pg.Pool({ connectionString: env.postgres, max: 4 });

describe('outbox relay', () => {
  let broker: Awaited<ReturnType<typeof openBroker>>;
  const seen: EventEnvelope[] = [];
  const type = uniqueName('relay.test');
  const queue = uniqueName('probe.relay');
  let app: Awaited<ReturnType<typeof startBackbone>>;

  beforeAll(async () => {
    await createOutboxTable(pool, 'outbox_events');
    broker = await openBroker();
    app = await startBackbone(
      [
        {
          queue,
          patterns: [type],
          handler: async (event) => {
            seen.push(event);
          },
        },
      ],
      { batchSize: 10, pollIntervalMs: 50 },
    );
    await until(() => queueExists(broker.connection, queue));
  });

  afterAll(async () => {
    await app.close();
    for (const name of [queue, queue + '.retry', queue + '.dlq'])
      await broker.channel.deleteQueue(name).catch(() => undefined);
    await broker.close();
    await pool.end();
  });

  it('publishes each outbox row once, in the documented envelope, and marks it published', async () => {
    const ids = [
      await addOutboxEvent(pool, 'outbox_events', type),
      await addOutboxEvent(pool, 'outbox_events', type),
      await addOutboxEvent(pool, 'outbox_events', type),
    ];
    await until(() => seen.length >= 3);

    expect(seen.map((event) => event.eventId).sort()).toEqual([...ids].sort());
    expect(seen[0]).toMatchObject({
      type,
      version: 1,
      correlationId: 'corr-1',
      organizationId: null,
      payload: { n: 1 },
    });
    await until(async () => {
      const { rows } = await pool.query(
        'select count(*)::int as n from outbox_events where id = any($1) and published_at is not null',
        [ids],
      );
      return rows[0].n === 3;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen.filter((event) => ids.includes(event.eventId))).toHaveLength(3);
  });

  describe('when the process fails mid-batch', () => {
    const table = 'outbox_crash_test';
    const crashType = uniqueName('crash.test');
    const crashQueue = uniqueName('probe.crash');
    const received: EventEnvelope[] = [];
    let channel: ConfirmChannel;

    beforeAll(async () => {
      await createOutboxTable(pool, table);
      channel = broker.channel;
      await channel.assertQueue(crashQueue, { durable: true });
      await channel.bindQueue(crashQueue, 'solmira.events', crashType);
      await channel.consume(crashQueue, (message) => {
        if (!message) return;
        received.push(JSON.parse(message.content.toString('utf8')) as EventEnvelope);
        channel.ack(message);
      });
    });

    afterAll(async () => {
      await channel.deleteQueue(crashQueue).catch(() => undefined);
      await pool.query('drop table if exists ' + table);
    });

    it('keeps rows unpublished when the broker does not confirm, then publishes them later', async () => {
      const ids = [
        await addOutboxEvent(pool, table, crashType),
        await addOutboxEvent(pool, table, crashType),
      ];
      const refusing = {
        publish: () => true,
        waitForConfirms: async () => Promise.reject(new Error('nack')),
      };
      await expect(
        relayOutboxBatch(pool, refusing as unknown as ConfirmChannel, 10, table),
      ).rejects.toThrow('nack');

      const { rows } = await pool.query(
        'select count(*)::int as n from ' + table + ' where published_at is null and id = any($1)',
        [ids],
      );
      expect(rows[0].n).toBe(2);

      const result = await relayOutboxBatch(pool, channel, 10, table);
      expect(result.published).toBe(2);
      await until(() => received.length >= 2);
      expect(received.map((event) => event.eventId).sort()).toEqual([...ids].sort());
    });

    it('publishes again when the crash happens after publishing but before the commit', async () => {
      const id = await addOutboxEvent(pool, table, crashType);
      const before = received.length;
      // A dedicated connection that dies when asked to commit: the broker has the messages,
      // PostgreSQL does not know they were published.
      const dyingPool = {
        connect: async () => {
          const client = new pg.Client({ connectionString: env.postgres });
          await client.connect();
          const query = client.query.bind(client) as (
            text: string,
            ...rest: unknown[]
          ) => Promise<unknown>;
          client.query = ((text: string, ...rest: unknown[]) =>
            text === 'commit'
              ? Promise.reject(new Error('crash before commit'))
              : query(text, ...rest)) as typeof client.query;
          (client as unknown as { release: () => void }).release = () => void client.end();
          return client;
        },
      } as unknown as pg.Pool;
      await expect(relayOutboxBatch(dyingPool, channel, 10, table)).rejects.toThrow(
        'crash before commit',
      );
      await relayOutboxBatch(pool, channel, 10, table);

      await until(() => received.filter((event) => event.eventId === id).length >= 2);
      expect(received.length - before).toBe(2);
    });

    it('lets two relays share one outbox without publishing a row twice', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i += 1) ids.push(await addOutboxEvent(pool, table, crashType));
      const before = received.length;
      const [a, b] = await Promise.all([
        relayOutboxBatch(pool, channel, 10, table),
        relayOutboxBatch(pool, channel, 10, table),
      ]);
      expect(a.published + b.published).toBe(20);
      await until(() => received.length - before >= 20);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const delivered = received.slice(before).map((event) => event.eventId);
      expect(new Set(delivered).size).toBe(20);
      expect(delivered).toHaveLength(20);
    });
  });
});
