import { z } from 'zod';
import type { IdentityEventType, IngestEventType } from './events.js';
import { paginationQuerySchema } from './pagination.js';
import { timestampSchema } from './resource-fields.js';

/**
 * The audit trail (ADR-0036): who did what to which object, and when, for every administrative
 * action of an organization. Audit records are built from the integration events the services
 * already write to their outboxes in the same transaction as the change, so an action and its
 * record exist together or not at all.
 */

export const AUDIT_TARGET_TYPES = [
  'organization',
  'member',
  'invitation',
  'application',
  'api_key',
  'event_type',
  'endpoint',
  'message',
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** Where in the event payload the id of the target is; the first field present wins. */
export interface AuditTargetSource {
  readonly type: AuditTargetType;
  readonly field: string;
}

export type AuditRule =
  | { readonly audited: true; readonly targets: readonly AuditTargetSource[] }
  | { readonly audited: false; readonly reason: string };

const audited = (...targets: AuditTargetSource[]): AuditRule => ({ audited: true, targets });
const target = (type: AuditTargetType, field: string): AuditTargetSource => ({ type, field });
const excluded = (reason: string): AuditRule => ({ audited: false, reason });

const AUTHENTICATION =
  'An authentication event of a person, not an administrative action of a tenant';
const OWN_ACCOUNT =
  "A person's change to their own account, which belongs to no organization's trail";
const DATA_PLANE =
  'High-volume delivery data, not an administrative action; see the message history';

/**
 * Every event type must be decided here. The type is a Record over all event types, so adding an
 * event without deciding whether it is audited does not compile.
 */
export const AUDIT_POLICY: Readonly<Record<IdentityEventType | IngestEventType, AuditRule>> = {
  'user.registered': excluded(AUTHENTICATION),
  'user.logged_in': excluded(AUTHENTICATION),
  'user.logged_out': excluded(AUTHENTICATION),
  'user.password_reset': excluded(AUTHENTICATION),
  'user.email_verified': excluded(AUTHENTICATION),
  'user.profile_updated': excluded(OWN_ACCOUNT),
  'user.password_changed': excluded(AUTHENTICATION),
  'session.revoked': excluded(AUTHENTICATION),
  'organization.created': audited(target('organization', 'organizationId')),
  'organization.updated': audited(target('organization', 'organizationId')),
  'member.invited': audited(target('invitation', 'invitationId')),
  'invitation.revoked': audited(target('invitation', 'invitationId')),
  'member.joined': audited(target('member', 'memberId')),
  'member.role_changed': audited(target('member', 'memberId')),
  'member.status_changed': audited(target('member', 'memberId')),
  'member.removed': audited(target('member', 'memberId')),
  'application.created': audited(target('application', 'applicationId')),
  'application.updated': audited(target('application', 'applicationId')),
  'application.archived': audited(target('application', 'applicationId')),
  'application.restored': audited(target('application', 'applicationId')),
  'api_key.created': audited(target('api_key', 'apiKeyId')),
  'api_key.revoked': audited(target('api_key', 'apiKeyId')),
  'event_type.created': audited(target('event_type', 'eventTypeId')),
  'event_type.updated': audited(target('event_type', 'eventTypeId')),
  'event_type.archived': audited(target('event_type', 'eventTypeId')),
  'endpoint.created': audited(target('endpoint', 'endpointId')),
  'endpoint.updated': audited(target('endpoint', 'endpointId')),
  'endpoint.archived': audited(target('endpoint', 'endpointId')),
  'endpoint.test_sent': audited(target('endpoint', 'endpointId')),
  'endpoint.auto_disabled': audited(target('endpoint', 'endpointId')),
  'endpoint_secret.revealed': audited(target('endpoint', 'endpointId')),
  'endpoint_secret.rotated': audited(target('endpoint', 'endpointId')),
  'delivery.replayed': audited(target('message', 'messageId'), target('endpoint', 'endpointId')),
  'message.created': excluded(DATA_PLANE),
  'delivery.attempted': excluded(DATA_PLANE),
};

export const AUDITED_EVENT_TYPES: readonly string[] = Object.entries(AUDIT_POLICY)
  .filter(([, rule]) => rule.audited)
  .map(([type]) => type);

export const AUDIT_ACTOR_TYPES = ['user', 'system'] as const;

export const auditRecordSchema = z.object({
  id: z.uuid(),
  /** The event type, for example `endpoint_secret.revealed`. */
  action: z.string(),
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  /** The person who acted; null when the platform did (an automatic disabling). */
  actorId: z.uuid().nullable(),
  targetType: z.enum(AUDIT_TARGET_TYPES),
  targetId: z.uuid().nullable(),
  occurredAt: timestampSchema,
  correlationId: z.string(),
  /** What the event said about the change: ids and field names, never secrets. */
  details: z.record(z.string(), z.unknown()),
});
export type AuditRecord = z.infer<typeof auditRecordSchema>;

export const auditLogQuerySchema = paginationQuerySchema.extend({
  action: z.string().min(1).max(100).optional(),
  actorId: z.uuid().optional(),
  targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
  targetId: z.uuid().optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
