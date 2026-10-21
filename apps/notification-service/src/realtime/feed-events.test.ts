import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { toRealtimeEvent } from './feed-events.js';

const envelope = (
  type: string,
  payload: unknown,
  organizationId: string | null = randomUUID(),
): EventEnvelope => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt: '2026-10-21T10:00:00.000Z',
  organizationId,
  actorId: null,
  correlationId: 'test',
  causationId: null,
  payload,
});

const attempt = {
  deliveryId: randomUUID(),
  messageId: randomUUID(),
  endpointId: randomUUID(),
  applicationId: randomUUID(),
  eventType: 'order.created',
  attempt: 1,
  result: 'succeeded',
  statusCode: 200,
  errorClass: null,
  durationMs: 42,
  startedAt: '2026-10-21T10:00:00.000Z',
  nextAttemptAt: null,
};

describe('toRealtimeEvent', () => {
  it('maps a delivery attempt and keeps only its known fields', () => {
    const event = toRealtimeEvent(
      envelope('delivery.attempted', { ...attempt, url: 'https://secret.example/x?token=1' }),
    );
    expect(event).toMatchObject({
      type: 'delivery.attempted',
      data: { durationMs: 42, attempt: 1 },
    });
    expect(JSON.stringify(event)).not.toContain('secret.example');
  });

  it('maps a created message without its internal event type id', () => {
    const data = {
      messageId: randomUUID(),
      applicationId: randomUUID(),
      eventTypeId: randomUUID(),
    };
    const event = toRealtimeEvent(envelope('message.created', data));
    expect(event?.data).toEqual({ messageId: data.messageId, applicationId: data.applicationId });
  });

  it('maps an automatic disabling with the host only', () => {
    const event = toRealtimeEvent(
      envelope('endpoint.auto_disabled', {
        endpointId: randomUUID(),
        applicationId: randomUUID(),
        host: 'hooks.example',
        failingSince: '2026-10-10T00:00:00.000Z',
        consecutiveFailures: 9,
      }),
    );
    expect(event).toMatchObject({
      type: 'endpoint.auto_disabled',
      data: { host: 'hooks.example' },
    });
    expect(event?.data).not.toHaveProperty('consecutiveFailures');
  });

  it('ignores events without an organization, of other types, or with a bad payload', () => {
    expect(toRealtimeEvent(envelope('delivery.attempted', attempt, null))).toBeNull();
    expect(toRealtimeEvent(envelope('user.registered', { userId: randomUUID() }))).toBeNull();
    expect(toRealtimeEvent(envelope('delivery.attempted', { deliveryId: 'x' }))).toBeNull();
    expect(toRealtimeEvent(envelope('message.created', null))).toBeNull();
  });
});
