import { randomUUID } from 'node:crypto';
import { AUDITED_EVENT_TYPES, AUDIT_POLICY, type EventEnvelope } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { UnauditableEventError, toAuditRecord } from './audit-record.js';
import { sampleEvents } from '../../test/support/samples.js';

const envelope = (
  type: string,
  payload: unknown,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope => ({
  eventId: randomUUID(),
  type,
  version: 1,
  occurredAt: '2026-10-21T10:00:00.000Z',
  organizationId: randomUUID(),
  actorId: randomUUID(),
  correlationId: 'corr-1',
  causationId: null,
  payload,
  ...overrides,
});

describe('the audit policy', () => {
  it('has a sample for every audited event type, so none can be added untested', () => {
    expect(Object.keys(sampleEvents().payloads).sort()).toEqual([...AUDITED_EVENT_TYPES].sort());
  });

  it('gives a reason for every event type it leaves out', () => {
    for (const rule of Object.values(AUDIT_POLICY)) {
      if (!rule.audited) expect(rule.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('toAuditRecord', () => {
  it.each(Object.entries(sampleEvents().payloads))('records %s', (type, payload) => {
    const event = envelope(type, payload);
    const record = toAuditRecord(event)!;

    expect(record).toMatchObject({
      eventId: event.eventId,
      organizationId: event.organizationId,
      action: type,
      actorType: 'user',
      actorId: event.actorId,
      correlationId: 'corr-1',
    });
    expect(record.targetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.occurredAt.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(record.details).toEqual(payload);
  });

  it('names the target an event is about', () => {
    const { payloads, ids } = sampleEvents();
    const targetOf = (type: string) => {
      const record = toAuditRecord(envelope(type, payloads[type]))!;
      return [record.targetType, record.targetId];
    };
    expect(targetOf('endpoint_secret.revealed')).toEqual(['endpoint', ids.endpoint]);
    expect(targetOf('member.role_changed')).toEqual(['member', ids.member]);
    expect(targetOf('api_key.revoked')).toEqual(['api_key', ids.apiKey]);
    expect(targetOf('member.invited')).toEqual(['invitation', ids.invitation]);
  });

  it('attributes a replay to the message, or to the endpoint when a whole endpoint was replayed', () => {
    const application = randomUUID();
    const endpoint = randomUUID();
    const byEndpoint = toAuditRecord(
      envelope('delivery.replayed', {
        applicationId: application,
        messageId: null,
        endpointId: endpoint,
        deliveries: 12,
      }),
    )!;
    expect([byEndpoint.targetType, byEndpoint.targetId]).toEqual(['endpoint', endpoint]);
  });

  it('records an action of the platform itself as a system action', () => {
    const { payloads } = sampleEvents();
    const record = toAuditRecord(
      envelope('endpoint.auto_disabled', payloads['endpoint.auto_disabled'], { actorId: null }),
    )!;
    expect(record).toMatchObject({ actorType: 'system', actorId: null });
  });

  it('ignores event types that are not administrative actions', () => {
    for (const type of [
      'message.created',
      'delivery.attempted',
      'user.logged_in',
      'user.profile_updated',
      'user.password_changed',
      'session.revoked',
    ]) {
      expect(toAuditRecord(envelope(type, {}))).toBeNull();
    }
    expect(toAuditRecord(envelope('something.unknown', {}))).toBeNull();
  });

  it('refuses an audited event it cannot attribute, instead of dropping it', () => {
    const { payloads } = sampleEvents();
    const created = payloads['application.created'];
    expect(() =>
      toAuditRecord(envelope('application.created', created, { organizationId: null })),
    ).toThrow(UnauditableEventError);
    expect(() => toAuditRecord(envelope('application.created', { name: 'x' }))).toThrow(
      UnauditableEventError,
    );
    expect(() => toAuditRecord(envelope('application.created', 'text'))).toThrow(
      UnauditableEventError,
    );
  });
});
