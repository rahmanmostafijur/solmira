import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@solmira/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  discardDeadLetters,
  peekDeadLetters,
  requeueDeadLetters,
} from '../src/messaging/dead-letters.js';
import { EVENTS_EXCHANGE, deadLetterQueueOf, retryQueueOf } from '../src/messaging/topology.js';
import { openBroker, queueExists, startBackbone, uniqueName, until } from './support-backbone.js';

const envelope = (type: string): EventEnvelope => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt: new Date().toISOString(),
  organizationId: randomUUID(),
  actorId: null,
  correlationId: 'corr-' + randomUUID().slice(0, 8),
  causationId: null,
  payload: { customerSecret: 'never shown by the tool' },
});

describe('dead-letter tooling', () => {
  let broker: Awaited<ReturnType<typeof openBroker>>;
  let app: Awaited<ReturnType<typeof startBackbone>>;
  const queue = uniqueName('probe.dead');
  const type = uniqueName('dead.test');
  const handled: { eventId: string; attempt: number }[] = [];
  let failing = true;

  const deadCount = async () =>
    (await broker.channel.checkQueue(deadLetterQueueOf(queue))).messageCount;
  const publish = (event: EventEnvelope) =>
    broker.channel.publish(EVENTS_EXCHANGE, type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
    });

  beforeAll(async () => {
    broker = await openBroker();
    app = await startBackbone(
      [
        {
          queue,
          patterns: [type],
          retryDelayMs: 50,
          maxAttempts: 1,
          handler: async (event, { attempt }) => {
            if (failing) throw new Error('cannot process');
            handled.push({ eventId: event.eventId, attempt });
          },
        },
      ],
      null,
    );
    await until(() => queueExists(broker.connection, queue));
  });

  afterAll(async () => {
    await app.close();
    for (const name of [queue, retryQueueOf(queue), deadLetterQueueOf(queue)])
      await broker.channel.deleteQueue(name).catch(() => undefined);
    await broker.close();
  });

  it('lists dead letters by identity, never by content, and leaves them in place', async () => {
    const event = envelope(type);
    publish(event);
    await until(async () => (await deadCount()) === 1);

    const summaries = await peekDeadLetters(broker.channel, queue, 10);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      eventId: event.eventId,
      type,
      organizationId: event.organizationId,
      correlationId: event.correlationId,
      reason: 'rejected',
    });
    expect(JSON.stringify(summaries)).not.toContain('never shown');
    expect(await deadCount()).toBe(1);
  });

  it('moves dead letters back to the consumer, which then processes them from a fresh attempt', async () => {
    const [first] = await peekDeadLetters(broker.channel, queue, 1);
    const eventId = first!.eventId;
    failing = false;

    const confirm = await broker.connection.createConfirmChannel();
    expect(await requeueDeadLetters(confirm, queue, 10)).toBe(1);
    await confirm.close();

    await until(() => handled.some((entry) => entry.eventId === eventId));
    expect(handled.find((entry) => entry.eventId === eventId)!.attempt).toBe(1);
    expect(await deadCount()).toBe(0);
  });

  it('discards only the events it is told to, and puts the rest back', async () => {
    failing = true;
    const keep = envelope(type);
    const drop = envelope(type);
    publish(keep);
    publish(drop);
    await until(async () => (await deadCount()) === 2);

    const discarded = await discardDeadLetters(broker.channel, queue, new Set([drop.eventId]), 10);

    expect(discarded).toBe(1);
    await until(async () => (await deadCount()) === 1);
    const remaining = await peekDeadLetters(broker.channel, queue, 10);
    expect(remaining.map((entry) => entry.eventId)).toEqual([keep.eventId]);
  });

  it('does nothing to an empty dead-letter queue', async () => {
    const empty = uniqueName('probe.empty');
    await broker.channel.assertQueue(deadLetterQueueOf(empty), { durable: true });
    expect(await peekDeadLetters(broker.channel, empty, 10)).toEqual([]);
    const confirm = await broker.connection.createConfirmChannel();
    expect(await requeueDeadLetters(confirm, empty, 10)).toBe(0);
    await confirm.close();
    await broker.channel.deleteQueue(deadLetterQueueOf(empty));
  });
});
