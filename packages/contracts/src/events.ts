/**
 * The integration event envelope and the identity events. Events are written to the producing
 * service's outbox in the same transaction as the change; a relay publishes them to RabbitMQ.
 */
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

export interface IdentityEventPayloads {
  'user.registered': { userId: string };
  'user.logged_in': { userId: string; sessionId: string };
  'user.logged_out': { userId: string; sessionId: string };
  'user.password_reset': { userId: string };
  'user.email_verified': { userId: string };
  'session.revoked': {
    userId: string;
    sessionId: string;
    reason:
      'logout' | 'user_request' | 'refresh_token_reuse' | 'password_reset' | 'account_disabled';
  };
  'organization.created': { organizationId: string; name: string; ownerUserId: string };
  'organization.updated': { organizationId: string; fields: string[] };
  'member.invited': { invitationId: string; email: string; role: string };
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
  'application.created': { applicationId: string; name: string };
  'application.updated': { applicationId: string; fields: string[] };
  'application.archived': { applicationId: string };
  'application.restored': { applicationId: string };
  'api_key.created': { apiKeyId: string; applicationId: string; prefix: string; scopes: string[] };
  'api_key.revoked': { apiKeyId: string; applicationId: string };
  'event_type.created': { eventTypeId: string; name: string };
  'event_type.updated': { eventTypeId: string; fields: string[] };
  'event_type.archived': { eventTypeId: string };
  'endpoint.created': { endpointId: string; applicationId: string };
  'endpoint.updated': { endpointId: string; applicationId: string; fields: string[] };
  'endpoint.archived': { endpointId: string; applicationId: string };
  'endpoint_secret.revealed': { endpointId: string; applicationId: string; secretId: string };
}

export type IngestEventType = keyof IngestEventPayloads;
