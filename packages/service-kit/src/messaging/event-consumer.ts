import { SpanKind, withSpan } from '@solmira/telemetry';
import { eventEnvelopeSchema, type EventEnvelope } from '@solmira/contracts';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { retryQueueOf } from './topology.js';

export interface ConsumerContext {
  /** 1 on the first delivery, then one more for every retry. */
  readonly attempt: number;
}

export interface EventConsumerDefinition {
  /** The queue name, unique across the system, for example `ingest.fan-out`. */
  readonly queue: string;
  readonly patterns: readonly string[];
  /** Must be safe to run twice for the same event (it claims the event id; see claimEvent). */
  readonly handler: (event: EventEnvelope, context: ConsumerContext) => Promise<void>;
  readonly prefetch?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_DELAY_MS = 5_000;
export const DEFAULT_PREFETCH = 10;

const ATTEMPT_HEADER = 'x-attempts';

export function attemptOf(message: ConsumeMessage): number {
  const previous = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 0);
  return (Number.isFinite(previous) ? previous : 0) + 1;
}

export type MessageOutcome = 'processed' | 'retried' | 'dead-lettered';

/**
 * Processes one delivery (ADR-0029). Acknowledgement happens only after the outcome is safe:
 * a retry is republished and confirmed before the original is acknowledged, so a crash in
 * between redelivers the original instead of losing it.
 */
export async function processMessage(
  channel: ConfirmChannel,
  definition: EventConsumerDefinition,
  message: ConsumeMessage,
  onFailure: (error: unknown, attempt: number, willRetry: boolean) => void,
): Promise<MessageOutcome> {
  const attempt = attemptOf(message);
  const maxAttempts = definition.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let envelope: EventEnvelope;
  try {
    envelope = eventEnvelopeSchema.parse(JSON.parse(message.content.toString('utf8')));
  } catch (error) {
    // A message that cannot be understood will never succeed: straight to the DLQ.
    onFailure(error, attempt, false);
    channel.nack(message, false, false);
    return 'dead-lettered';
  }

  try {
    // A span per processed event; the correlation id ties it to the request that started the flow.
    await withSpan(
      'event.consume',
      {
        'messaging.destination.name': definition.queue,
        'messaging.attempt': attempt,
        'event.type': envelope.type,
        'event.id': envelope.eventId,
        'correlation.id': envelope.correlationId,
        'organization.id': envelope.organizationId ?? '',
      },
      () => definition.handler(envelope, { attempt }),
      SpanKind.CONSUMER,
    );
    channel.ack(message);
    return 'processed';
  } catch (error) {
    const willRetry = attempt < maxAttempts;
    onFailure(error, attempt, willRetry);
    if (!willRetry) {
      channel.nack(message, false, false);
      return 'dead-lettered';
    }
    channel.sendToQueue(retryQueueOf(definition.queue), message.content, {
      persistent: true,
      messageId: message.properties.messageId,
      type: message.properties.type,
      contentType: message.properties.contentType,
      headers: { ...message.properties.headers, [ATTEMPT_HEADER]: attempt },
    });
    await channel.waitForConfirms();
    channel.ack(message);
    return 'retried';
  }
}
