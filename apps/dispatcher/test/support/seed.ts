import { randomBytes, randomUUID } from 'node:crypto';
import { LocalSecretCipher, secretContext } from '@solmira/service-kit';
import type pg from 'pg';

export const TEST_KEY = randomBytes(32).toString('base64');
const cipher = new LocalSecretCipher(TEST_KEY, 'local-1');

export interface FixtureOptions {
  readonly organizationId?: string;
  readonly url: string;
  readonly payload?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly enabled?: boolean;
  readonly archived?: boolean;
  readonly status?: string;
  readonly attemptCount?: number;
  readonly dueIn?: string;
  /** Add a second, previous secret that is still valid (a rotation window). */
  readonly previousSecret?: boolean;
}

export interface Fixture {
  readonly organizationId: string;
  readonly applicationId: string;
  readonly endpointId: string;
  readonly messageId: string;
  readonly deliveryId: string;
  readonly secret: string;
  readonly previousSecret: string | null;
}

const newSecret = () => 'whsec_' + randomBytes(32).toString('base64');

async function insertSecret(
  db: pg.Pool,
  organizationId: string,
  endpointId: string,
  secret: string,
  status: 'active' | 'previous',
) {
  const encrypted = cipher.encrypt(secret, secretContext(organizationId, endpointId));
  await db.query(
    `insert into endpoint_secrets (id, organization_id, endpoint_id, status, ciphertext, wrapped_data_key, key_id, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, case when $4 = 'previous' then now() + interval '1 day' else null end)`,
    [
      randomUUID(),
      organizationId,
      endpointId,
      status,
      encrypted.ciphertext,
      encrypted.wrappedDataKey,
      encrypted.keyId,
    ],
  );
}

/** One endpoint with a real encrypted secret, one message and one delivery, inserted as the owner. */
export async function seedDelivery(db: pg.Pool, options: FixtureOptions): Promise<Fixture> {
  const organizationId = options.organizationId ?? randomUUID();
  const applicationId = randomUUID();
  const eventTypeId = randomUUID();
  const endpointId = randomUUID();
  const messageId = randomUUID();
  const deliveryId = randomUUID();
  const secret = newSecret();
  const previousSecret = options.previousSecret ? newSecret() : null;

  await db.query(`insert into applications (id, organization_id, name) values ($1, $2, $3)`, [
    applicationId,
    organizationId,
    'app-' + applicationId,
  ]);
  await db.query(`insert into event_types (id, organization_id, name) values ($1, $2, $3)`, [
    eventTypeId,
    organizationId,
    'seed.' + eventTypeId,
  ]);
  await db.query(
    `insert into endpoints (id, organization_id, application_id, url, headers, enabled, archived_at)
     values ($1, $2, $3, $4, $5, $6, case when $7::boolean then now() else null end)`,
    [
      endpointId,
      organizationId,
      applicationId,
      options.url,
      JSON.stringify(options.headers ?? {}),
      options.enabled ?? true,
      options.archived ?? false,
    ],
  );
  await insertSecret(db, organizationId, endpointId, secret, 'active');
  if (previousSecret)
    await insertSecret(db, organizationId, endpointId, previousSecret, 'previous');
  const payload = options.payload ?? { id: 'inv_1', amount: 5 };
  await db.query(
    `insert into messages (id, organization_id, application_id, event_type_id, payload, payload_bytes, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      messageId,
      organizationId,
      applicationId,
      eventTypeId,
      JSON.stringify(payload),
      JSON.stringify(payload).length,
      'seed-' + messageId,
    ],
  );
  await db.query(
    `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id, status, attempt_count, next_attempt_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval)`,
    [
      deliveryId,
      organizationId,
      applicationId,
      messageId,
      endpointId,
      options.status ?? 'pending',
      options.attemptCount ?? 0,
      options.dueIn ?? '-1 second',
    ],
  );
  return {
    organizationId,
    applicationId,
    endpointId,
    messageId,
    deliveryId,
    secret,
    previousSecret,
  };
}
