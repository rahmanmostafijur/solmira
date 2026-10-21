import { randomUUID } from 'node:crypto';
import type { IdentityEventPayloads, IngestEventPayloads } from '@solmira/contracts';

/**
 * One realistic payload for every audited event type, typed by the event contracts so a changed
 * payload shape fails to compile. The audit test checks this table covers every audited type.
 */
export function sampleEvents() {
  const ids = {
    org: randomUUID(),
    member: randomUUID(),
    invitation: randomUUID(),
    application: randomUUID(),
    apiKey: randomUUID(),
    eventType: randomUUID(),
    endpoint: randomUUID(),
    secret: randomUUID(),
    message: randomUUID(),
  };
  const identity: Partial<{ [K in keyof IdentityEventPayloads]: IdentityEventPayloads[K] }> = {
    'organization.created': { organizationId: ids.org, name: 'Acme', ownerUserId: randomUUID() },
    'organization.updated': { organizationId: ids.org, fields: ['name'] },
    'member.invited': { invitationId: ids.invitation, email: 'a@example.com', role: 'STAFF' },
    'member.joined': { memberId: ids.member, userId: randomUUID(), role: 'STAFF' },
    'member.role_changed': {
      memberId: ids.member,
      userId: randomUUID(),
      fromRole: 'STAFF',
      toRole: 'MANAGER',
    },
    'member.status_changed': { memberId: ids.member, userId: randomUUID(), status: 'SUSPENDED' },
    'member.removed': { memberId: ids.member, userId: randomUUID() },
  };
  const ingest: Partial<{ [K in keyof IngestEventPayloads]: IngestEventPayloads[K] }> = {
    'application.created': { applicationId: ids.application, name: 'Storefront' },
    'application.updated': { applicationId: ids.application, fields: ['name'] },
    'application.archived': { applicationId: ids.application },
    'application.restored': { applicationId: ids.application },
    'api_key.created': {
      apiKeyId: ids.apiKey,
      applicationId: ids.application,
      prefix: 'slm_abcd1234',
      scopes: ['messages:write'],
    },
    'api_key.revoked': { apiKeyId: ids.apiKey, applicationId: ids.application },
    'event_type.created': { eventTypeId: ids.eventType, name: 'order.created' },
    'event_type.updated': { eventTypeId: ids.eventType, fields: ['description'] },
    'event_type.archived': { eventTypeId: ids.eventType },
    'endpoint.created': { endpointId: ids.endpoint, applicationId: ids.application },
    'endpoint.updated': {
      endpointId: ids.endpoint,
      applicationId: ids.application,
      fields: ['url'],
    },
    'endpoint.archived': { endpointId: ids.endpoint, applicationId: ids.application },
    'endpoint.test_sent': {
      endpointId: ids.endpoint,
      applicationId: ids.application,
      messageId: ids.message,
    },
    'endpoint.auto_disabled': {
      endpointId: ids.endpoint,
      applicationId: ids.application,
      host: 'hooks.example',
      failingSince: '2026-10-10T00:00:00.000Z',
      consecutiveFailures: 40,
    },
    'endpoint_secret.revealed': {
      endpointId: ids.endpoint,
      applicationId: ids.application,
      secretId: ids.secret,
    },
    'endpoint_secret.rotated': {
      endpointId: ids.endpoint,
      applicationId: ids.application,
      previousSecretId: ids.secret,
      previousValidUntil: '2026-10-22T00:00:00.000Z',
    },
    'delivery.replayed': {
      applicationId: ids.application,
      messageId: ids.message,
      endpointId: null,
      deliveries: 3,
    },
  };
  return { ids, payloads: { ...identity, ...ingest } as Record<string, object> };
}
