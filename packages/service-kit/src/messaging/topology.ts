import type { Channel } from 'amqplib';

/** The one exchange every integration event is published to; the routing key is the event type. */
export const EVENTS_EXCHANGE = 'solmira.events';
/** Where rejected messages go; each consumer queue has its own dead-letter queue behind it. */
export const EVENTS_DEAD_LETTER_EXCHANGE = 'solmira.events.dlx';

export const retryQueueOf = (queue: string) => queue + '.retry';
export const deadLetterQueueOf = (queue: string) => queue + '.dlq';

export async function assertEventExchanges(channel: Channel): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(EVENTS_DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
}

export interface ConsumerQueueOptions {
  readonly queue: string;
  /** Routing key patterns, for example `message.created` or `endpoint.*`. */
  readonly patterns: readonly string[];
  /** How long a failed message waits before it is delivered again. */
  readonly retryDelayMs: number;
}

/**
 * Declares a consumer's queue, its retry queue and its dead-letter queue (ADR-0029):
 * - failures are republished to `<queue>.retry`, whose fixed TTL returns them to `<queue>`;
 * - a message that is rejected is dead-lettered to `<queue>.dlq` for an operator.
 * A fixed TTL on the queue (not per message) avoids a long delay blocking shorter ones.
 */
export async function assertConsumerQueues(
  channel: Channel,
  options: ConsumerQueueOptions,
): Promise<void> {
  const { queue, patterns, retryDelayMs } = options;
  await channel.assertQueue(deadLetterQueueOf(queue), { durable: true });
  await channel.bindQueue(deadLetterQueueOf(queue), EVENTS_DEAD_LETTER_EXCHANGE, queue);
  await channel.assertQueue(queue, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': EVENTS_DEAD_LETTER_EXCHANGE,
      'x-dead-letter-routing-key': queue,
    },
  });
  await channel.assertQueue(retryQueueOf(queue), {
    durable: true,
    arguments: {
      'x-message-ttl': retryDelayMs,
      // The default exchange routes by queue name, which returns the message to the main queue.
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': queue,
    },
  });
  for (const pattern of patterns) await channel.bindQueue(queue, EVENTS_EXCHANGE, pattern);
}
