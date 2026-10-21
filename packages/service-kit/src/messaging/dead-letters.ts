import type { Channel, ConfirmChannel, GetMessage } from 'amqplib';
import { ATTEMPT_HEADER } from './event-consumer.js';
import { deadLetterQueueOf } from './topology.js';

/**
 * What an operator may look at without reading customer data: who and what, never the body. The
 * events carry ids by design (ADR-0029), but the tool shows only the envelope's identity.
 */
export interface DeadLetterSummary {
  readonly eventId: string | null;
  readonly type: string | null;
  readonly organizationId: string | null;
  readonly correlationId: string | null;
  readonly occurredAt: string | null;
  /** Why the broker dead-lettered it, from its own header: rejected, expired, maxlen. */
  readonly reason: string | null;
  readonly bytes: number;
}

export function summarize(message: GetMessage): DeadLetterSummary {
  let envelope: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(message.content.toString('utf8'));
    if (parsed && typeof parsed === 'object') envelope = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: the summary says so by having no fields.
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const death = (
    message.properties.headers?.['x-death'] as { reason?: unknown }[] | undefined
  )?.[0];
  return {
    eventId: text(envelope.eventId),
    type: text(envelope.type),
    organizationId: text(envelope.organizationId),
    correlationId: text(envelope.correlationId),
    occurredAt: text(envelope.occurredAt),
    reason: text(death?.reason),
    bytes: message.content.length,
  };
}

/** Fetches up to `limit` messages without acknowledging them; the caller decides what happens to each. */
async function take(channel: Channel, queue: string, limit: number): Promise<GetMessage[]> {
  const taken: GetMessage[] = [];
  while (taken.length < limit) {
    const message = await channel.get(queue, { noAck: false });
    if (!message) break;
    taken.push(message);
  }
  return taken;
}

/** Lists what is in the dead-letter queue of a consumer, and leaves all of it there. */
export async function peekDeadLetters(
  channel: Channel,
  consumerQueue: string,
  limit: number,
): Promise<DeadLetterSummary[]> {
  const messages = await take(channel, deadLetterQueueOf(consumerQueue), limit);
  const summaries = messages.map(summarize);
  for (const message of messages) channel.nack(message, false, true);
  return summaries;
}

/**
 * Moves up to `limit` dead letters back to the consumer's own queue, with a fresh attempt count. A
 * message is acknowledged in the dead-letter queue only after the broker confirmed the new copy, so a
 * crash leaves it in both places (consumers are idempotent, ADR-0029), never in neither.
 */
export async function requeueDeadLetters(
  channel: ConfirmChannel,
  consumerQueue: string,
  limit: number,
): Promise<number> {
  const messages = await take(channel, deadLetterQueueOf(consumerQueue), limit);
  for (const message of messages) {
    const headers = { ...message.properties.headers };
    delete headers[ATTEMPT_HEADER];
    delete headers['x-death'];
    delete headers['x-first-death-queue'];
    delete headers['x-first-death-reason'];
    delete headers['x-first-death-exchange'];
    channel.sendToQueue(consumerQueue, message.content, {
      persistent: true,
      messageId: message.properties.messageId,
      type: message.properties.type,
      contentType: message.properties.contentType,
      headers,
    });
  }
  await channel.waitForConfirms();
  for (const message of messages) channel.ack(message);
  return messages.length;
}

/** Throws away the dead letters whose event ids are given, and puts every other one back. */
export async function discardDeadLetters(
  channel: Channel,
  consumerQueue: string,
  eventIds: ReadonlySet<string>,
  limit: number,
): Promise<number> {
  const messages = await take(channel, deadLetterQueueOf(consumerQueue), limit);
  let discarded = 0;
  for (const message of messages) {
    const { eventId } = summarize(message);
    if (eventId !== null && eventIds.has(eventId)) {
      channel.ack(message);
      discarded += 1;
    } else {
      channel.nack(message, false, true);
    }
  }
  return discarded;
}
