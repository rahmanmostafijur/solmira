/**
 * The integration event envelope and the identity events. Events are written to the producing
 * service's outbox in the same transaction as the change; a relay publishes them to RabbitMQ.
 */
import { z } from 'zod';

export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  readonly eventId: string;
  readonly type: TType;
  readonly version: number;
  readonly occurredAt: string;
  readonly organizationId: string | null;
  readonly actorId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly payload: TPayload;
}

/** What consumers check before they trust a message from the queue. */
export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  type: z.string().min(1),
  version: z.number().int().min(1),
  occurredAt: z.iso.datetime(),
  organizationId: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  correlationId: z.string().min(1),
  causationId: z.uuid().nullable(),
  payload: z.unknown(),
});

export interface IdentityEventPayloads {
  'user.registered': { userId: string };
  'user.logged_in': { userId: string; sessionId: string };
  'user.logged_out': { userId: string; sessionId: string };
  'user.password_reset': { userId: string };
  'user.email_verified': { userId: string };
  /** Names the changed fields, never their values. */
  'user.profile_updated': { userId: string; fields: string[] };
  /** `sessionId` is the session the change was made from; every other session is revoked. */
  'user.password_changed': { userId: string; sessionId: string };
  'session.revoked': {
    userId: string;
    sessionId: string;
    reason:
      | 'logout'
      | 'user_request'
      | 'refresh_token_reuse'
      | 'password_reset'
      | 'password_changed'
      | 'account_disabled';
  };
  'organization.created': { organizationId: string; name: string; ownerUserId: string };
  'organization.updated': { organizationId: string; fields: string[] };
  'member.invited': { invitationId: string; email: string; role: string };
  'invitation.revoked': { invitationId: string };
  'member.joined': { memberId: string; userId: string; role: string };
  'member.role_changed': { memberId: string; userId: string; fromRole: string; toRole: string };
  'member.status_changed': { memberId: string; userId: string; status: string };
  'member.removed': { memberId: string; userId: string };
}

export type IdentityEventType = keyof IdentityEventPayloads;

/**
 * Administrative events of ingest-service, recorded in its outbox in the same transaction as the
 * change. They never carry secrets, API keys or endpoint URLs (URLs can embed tokens).
 */
export interface IngestEventPayloads {
  /** The payload itself stays in the database; consumers load the message by id. */
  'message.created': { messageId: string; applicationId: string; eventTypeId: string };
  'application.created': { applicationId: string; name: string };
  'application.updated': { applicationId: string; fields: string[] };
  'application.archived': { applicationId: string };
  'application.restored': { applicationId: string };
  'api_key.created': { apiKeyId: string; applicationId: string; prefix: string; scopes: string[] };
  'api_key.updated': { apiKeyId: string; applicationId: string; fields: string[] };
  'api_key.revoked': { apiKeyId: string; applicationId: string };
  'event_type.created': { eventTypeId: string; name: string };
  'event_type.updated': { eventTypeId: string; fields: string[] };
  'event_type.archived': { eventTypeId: string };
  'event_type.restored': { eventTypeId: string };
  'endpoint.created': { endpointId: string; applicationId: string };
  'endpoint.updated': { endpointId: string; applicationId: string; fields: string[] };
  'endpoint.archived': { endpointId: string; applicationId: string };
  'endpoint.restored': { endpointId: string; applicationId: string };
  /** A test event was sent to one endpoint from the console. */
  'endpoint.test_sent': { endpointId: string; applicationId: string; messageId: string };
  'endpoint_secret.revealed': { endpointId: string; applicationId: string; secretId: string };
  'endpoint_secret.rotated': {
    endpointId: string;
    applicationId: string;
    previousSecretId: string;
    previousValidUntil: string;
  };
  /** An endpoint failed continuously for the configured period and was disabled. */
  'endpoint.auto_disabled': {
    endpointId: string;
    applicationId: string;
    /** The host only: URLs can carry tokens. */
    host: string;
    failingSince: string;
    consecutiveFailures: number;
  };
  'delivery.replayed': {
    applicationId: string;
    messageId: string | null;
    endpointId: string | null;
    deliveries: number;
  };
  /** One real send of a delivery and how it ended. Written by the dispatcher (ADR-0035). */
  'delivery.attempted': DeliveryAttemptedPayload;
}

export const DELIVERY_ATTEMPT_RESULTS = ['succeeded', 'retrying', 'failed'] as const;
export type DeliveryAttemptResult = (typeof DELIVERY_ATTEMPT_RESULTS)[number];

/** No URL, header, payload or response body: those stay in the database and the history. */
export const deliveryAttemptedPayloadSchema = z.object({
  deliveryId: z.uuid(),
  messageId: z.uuid(),
  endpointId: z.uuid(),
  applicationId: z.uuid(),
  eventType: z.string().min(1),
  attempt: z.number().int().min(1),
  result: z.enum(DELIVERY_ATTEMPT_RESULTS),
  statusCode: z.number().int().nullable(),
  errorClass: z.string().nullable(),
  durationMs: z.number().int().min(0),
  startedAt: z.iso.datetime(),
  nextAttemptAt: z.iso.datetime().nullable(),
});
export type DeliveryAttemptedPayload = z.infer<typeof deliveryAttemptedPayloadSchema>;

export type IngestEventType = keyof IngestEventPayloads;
