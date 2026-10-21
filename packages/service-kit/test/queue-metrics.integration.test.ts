import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@solmira/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../src/metrics/registry.js';
import { EVENTS_EXCHANGE, deadLetterQueueOf, retryQueueOf } from '../src/messaging/topology.js';
import { openBroker, queueExists, startBackbone, uniqueName, until } from './support-backbone.js';

describe('queue depth metrics', () => {
  let broker: Awaited<ReturnType<typeof openBroker>>;
  let app: Awaited<ReturnType<typeof startBackbone>>;
  const lines: Record<string, unknown>[] = [];
  const queue = uniqueName('probe.metrics');
  const type = uniqueName('metrics.test');

  beforeAll(async () => {
    broker = await openBroker();
    app = await startBackbone(
      [
        {
          queue,
          patterns: [type],
          retryDelayMs: 100,
          maxAttempts: 1,
          handler: async () => {
            throw new Error('always fails');
          },
        },
      ],
      null,
      { enabled: true, write: (line) => lines.push(JSON.parse(line)) },
    );
    await until(() => queueExists(broker.connection, queue));
  });

  afterAll(async () => {
    await app.close();
    for (const name of [queue, retryQueueOf(queue), deadLetterQueueOf(queue)])
      await broker.channel.deleteQueue(name).catch(() => undefined);
    await broker.close();
  });

  it('reports the dead letters of a consumer, so an alarm can watch them', async () => {
    const event: EventEnvelope = {
      eventId: randomUUID(),
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      organizationId: null,
      actorId: null,
      correlationId: 'corr-1',
      causationId: null,
      payload: {},
    };
    broker.channel.publish(EVENTS_EXCHANGE, type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
    });
    await until(
      async () => (await broker.channel.checkQueue(deadLetterQueueOf(queue))).messageCount === 1,
    );

    await app.get(MetricsRegistry).flush();

    const line = lines.find((entry) => entry.Queue === queue);
    expect(line).toMatchObject({
      Service: 'backbone-probe',
      Queue: queue,
      DeadLetterMessages: 1,
      QueueMessages: 0,
      RetryMessages: 0,
    });
  });
});
