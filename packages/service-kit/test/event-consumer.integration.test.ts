import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@solmira/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTS_EXCHANGE, deadLetterQueueOf, retryQueueOf } from '../src/messaging/topology.js';
import { openBroker, queueExists, startBackbone, uniqueName, until } from './support-backbone.js';

function envelope(type: string, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    organizationId: null,
    actorId: null,
    correlationId: 'corr-1',
    causationId: null,
    payload: {},
    ...overrides,
  };
}

describe('event consumers', () => {
  let broker: Awaited<ReturnType<typeof openBroker>>;
  let app: Awaited<ReturnType<typeof startBackbone>>;

  const flaky = {
    queue: uniqueName('probe.flaky'),
    type: uniqueName('flaky.test'),
    attempts: [] as number[],
  };
  const poison = {
    queue: uniqueName('probe.poison'),
    type: uniqueName('poison.test'),
    attempts: [] as number[],
  };
  const once = {
    queue: uniqueName('probe.once'),
    type: uniqueName('once.test'),
    effects: new Set<string>(),
    deliveries: 0,
  };
  const queues = [flaky.queue, poison.queue, once.queue];

  const publish = (type: string, body: unknown, messageId?: string) =>
    broker.channel.publish(
      EVENTS_EXCHANGE,
      type,
      Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
      {
        persistent: true,
        messageId,
      },
    );

  beforeAll(async () => {
    broker = await openBroker();
    app = await startBackbone(
      [
        {
          queue: flaky.queue,
          patterns: [flaky.type],
          retryDelayMs: 100,
          handler: async (_event, { attempt }) => {
            flaky.attempts.push(attempt);
            if (attempt < 3) throw new Error('temporary failure');
          },
        },
        {
          queue: poison.queue,
          patterns: [poison.type],
          retryDelayMs: 100,
          maxAttempts: 3,
          handler: async (_event, { attempt }) => {
            poison.attempts.push(attempt);
            throw new Error('always fails');
          },
        },
        {
          queue: once.queue,
          patterns: [once.type],
          handler: async (event) => {
            once.deliveries += 1;
            once.effects.add(event.eventId); // the effect is keyed by event id, so repeats are no-ops
          },
        },
      ],
      null,
    );
    for (const queue of queues) await until(() => queueExists(broker.connection, queue));
  });

  afterAll(async () => {
    await app.close();
    for (const queue of queues)
      for (const name of [queue, retryQueueOf(queue), deadLetterQueueOf(queue)])
        await broker.channel.deleteQueue(name).catch(() => undefined);
    await broker.close();
  });

  it('retries a failing handler with an attempt counter until it succeeds', async () => {
    publish(flaky.type, envelope(flaky.type));
    await until(() => flaky.attempts.length >= 3);
    expect(flaky.attempts).toEqual([1, 2, 3]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(flaky.attempts).toHaveLength(3);
    const dlq = await broker.channel.checkQueue(deadLetterQueueOf(flaky.queue));
    expect(dlq.messageCount).toBe(0);
  });

  it('moves a poison message to the dead-letter queue after the configured attempts', async () => {
    const event = envelope(poison.type);
    publish(poison.type, event);
    await until(
      async () =>
        (await broker.channel.checkQueue(deadLetterQueueOf(poison.queue))).messageCount === 1,
    );
    expect(poison.attempts).toEqual([1, 2, 3]);

    const dead = await broker.channel.get(deadLetterQueueOf(poison.queue), { noAck: true });
    expect(dead).not.toBe(false);
    if (dead)
      expect((JSON.parse(dead.content.toString('utf8')) as EventEnvelope).eventId).toBe(
        event.eventId,
      );
    const main = await broker.channel.checkQueue(poison.queue);
    expect(main.messageCount).toBe(0);
  });

  it('sends a message that is not a valid envelope straight to the dead-letter queue', async () => {
    publish(poison.type, '{"not":"an envelope"}');
    publish(poison.type, 'not json at all');
    await until(
      async () =>
        (await broker.channel.checkQueue(deadLetterQueueOf(poison.queue))).messageCount >= 2,
    );
    expect(poison.attempts).toEqual([1, 2, 3]);
  });

  it('applies the effect of a redelivered event once when the handler keys it by event id', async () => {
    const event = envelope(once.type);
    publish(once.type, event, event.eventId);
    publish(once.type, event, event.eventId);
    publish(once.type, event, event.eventId);
    await until(() => once.deliveries >= 3);
    expect(once.deliveries).toBe(3);
    expect(once.effects.size).toBe(1);
  });
});
