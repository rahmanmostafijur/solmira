import {
  AUDIT_POLICY,
  type AuditTargetType,
  type EventEnvelope,
  type IdentityEventType,
  type IngestEventType,
} from '@solmira/contracts';
import { z } from 'zod';

/** A record ready to store. */
export interface NewAuditRecord {
  readonly eventId: string;
  readonly organizationId: string;
  readonly action: string;
  readonly actorType: 'user' | 'system';
  readonly actorId: string | null;
  readonly targetType: AuditTargetType;
  readonly targetId: string | null;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly details: Record<string, unknown>;
}

const detailsSchema = z.record(z.string(), z.unknown());
const uuid = z.uuid();

/** Raised for an event the audit trail cannot make sense of; the consumer dead-letters it. */
export class UnauditableEventError extends Error {}

/**
 * Turns an administrative event into an audit record, or null for an event type that is decided
 * not to be audited. Throws for an audited event that lacks what a record needs (an organization),
 * rather than dropping it: a gap in the trail should be loud.
 */
export function toAuditRecord(event: EventEnvelope): NewAuditRecord | null {
  const rule = AUDIT_POLICY[event.type as IdentityEventType | IngestEventType];
  if (!rule?.audited) return null;

  const payload = detailsSchema.safeParse(event.payload);
  if (!payload.success) throw new UnauditableEventError(`${event.type} has no payload object`);
  const organizationId = event.organizationId;
  if (!organizationId) throw new UnauditableEventError(`${event.type} has no organization`);

  // The first target field the payload has wins (a replay names a message or, with null, an endpoint).
  const source = rule.targets.find((candidate) => payload.data[candidate.field] != null);
  const targetId = source ? uuid.safeParse(payload.data[source.field]) : undefined;
  if (!source || !targetId?.success)
    throw new UnauditableEventError(`${event.type} names no target`);

  return {
    eventId: event.eventId,
    organizationId,
    action: event.type,
    actorType: event.actorId ? 'user' : 'system',
    actorId: event.actorId,
    targetType: source.type,
    targetId: targetId.data,
    occurredAt: new Date(event.occurredAt),
    correlationId: event.correlationId,
    details: payload.data,
  };
}
