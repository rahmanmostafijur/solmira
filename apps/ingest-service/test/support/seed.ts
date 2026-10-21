import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface DeliverySeed {
  readonly organizationId: string;
  readonly applicationId: string;
  readonly endpointId: string;
  readonly eventTypeId: string;
}

/** An organization's application, event type and endpoint, inserted directly as the owner role. */
export async function seedOrganization(
  db: pg.Pool,
  organizationId = randomUUID(),
): Promise<DeliverySeed> {
  const applicationId = randomUUID();
  const eventTypeId = randomUUID();
  const endpointId = randomUUID();
  await db.query(`insert into applications (id, organization_id, name) values ($1, $2, 'seed')`, [
    applicationId,
    organizationId,
  ]);
  await db.query(
    `insert into event_types (id, organization_id, name) values ($1, $2, 'seed.event')`,
    [eventTypeId, organizationId],
  );
  await db.query(
    `insert into endpoints (id, organization_id, application_id, url) values ($1, $2, $3, 'https://example.com/hook')`,
    [endpointId, organizationId, applicationId],
  );
  return { organizationId, applicationId, endpointId, eventTypeId };
}

export interface DeliveryOptions {
  readonly status?: string;
  /** SQL interval relative to now, for example '-1 minute' (due) or '1 hour' (later). */
  readonly dueIn?: string;
  readonly attemptCount?: number;
  readonly lockedFor?: string;
}

/** A message with one delivery to the seeded endpoint. Returns the delivery id. */
export async function seedDelivery(
  db: pg.Pool,
  seed: DeliverySeed,
  options: DeliveryOptions = {},
): Promise<string> {
  const messageId = randomUUID();
  const deliveryId = randomUUID();
  await db.query(
    `insert into messages (id, organization_id, application_id, event_type_id, payload, payload_bytes, idempotency_key)
     values ($1, $2, $3, $4, '{"seed":true}', 13, $5)`,
    [messageId, seed.organizationId, seed.applicationId, seed.eventTypeId, 'seed-' + messageId],
  );
  await db.query(
    `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id, status, attempt_count, next_attempt_at, locked_until)
     values ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval, case when $9::text is null then null else now() + $9::interval end)`,
    [
      deliveryId,
      seed.organizationId,
      seed.applicationId,
      messageId,
      seed.endpointId,
      options.status ?? 'pending',
      options.attemptCount ?? 0,
      options.dueIn ?? '-1 minute',
      options.lockedFor ?? null,
    ],
  );
  return deliveryId;
}

/** Another endpoint of the same organization and application. */
export async function seedEndpoint(db: pg.Pool, seed: DeliverySeed): Promise<DeliverySeed> {
  const endpointId = randomUUID();
  await db.query(
    `insert into endpoints (id, organization_id, application_id, url) values ($1, $2, $3, 'https://example.com/other')`,
    [endpointId, seed.organizationId, seed.applicationId],
  );
  return { ...seed, endpointId };
}
