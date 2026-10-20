import { assertRowLevelSecurityEnforced } from '@solmira/service-kit';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Database-level proof of tenant isolation, without the application: what happens when code is
 * wrong. The runtime role is subject to RLS; composite keys bind even the owner role.
 */
const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });
const runtime = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });

const orgA = uuidv7();
const orgB = uuidv7();
const ids = {
  appA: uuidv7(),
  appB: uuidv7(),
  typeA: uuidv7(),
  typeB: uuidv7(),
  endpointA: uuidv7(),
  endpointB: uuidv7(),
  secretA: uuidv7(),
  keyA: uuidv7(),
  messageA: uuidv7(),
  messageB: uuidv7(),
};
const TABLES = [
  'applications',
  'event_types',
  'endpoints',
  'endpoint_event_types',
  'endpoint_secrets',
  'api_keys',
  'messages',
  'idempotency_keys',
  'deliveries',
] as const;

async function asTenant<T>(
  organizationId: string | null,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.organization_id', $1, true)`, [
      organizationId ?? '',
    ]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function seed(org: string, app: string, type: string, endpoint: string, message: string) {
  await owner.query(`insert into applications (id, organization_id, name) values ($1, $2, 'App')`, [
    app,
    org,
  ]);
  await owner.query(
    `insert into event_types (id, organization_id, name) values ($1, $2, 'thing.happened')`,
    [type, org],
  );
  await owner.query(
    `insert into endpoints (id, organization_id, application_id, url)
     values ($1, $2, $3, 'https://example.com')`,
    [endpoint, org, app],
  );
  await owner.query(
    `insert into endpoint_event_types (organization_id, endpoint_id, event_type_id)
     values ($1, $2, $3)`,
    [org, endpoint, type],
  );
  await owner.query(
    `insert into messages (id, organization_id, application_id, event_type_id, payload, payload_bytes, idempotency_key)
     values ($1, $2, $3, $4, '{}', 2, $5)`,
    [message, org, app, type, 'key-' + message],
  );
  await owner.query(
    `insert into idempotency_keys (organization_id, application_id, key, request_hash, message_id, expires_at)
     values ($1, $2, $4, 'hash', $3, now() + interval '1 day')`,
    [org, app, message, 'key-' + message],
  );
  await owner.query(
    `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id)
     values ($1, $2, $3, $4, $5)`,
    [uuidv7(), org, app, message, endpoint],
  );
}

describe('PostgreSQL Row Level Security (runtime role)', () => {
  beforeAll(async () => {
    await seed(orgA, ids.appA, ids.typeA, ids.endpointA, ids.messageA);
    await seed(orgB, ids.appB, ids.typeB, ids.endpointB, ids.messageB);
    await owner.query(
      `insert into endpoint_secrets (id, organization_id, endpoint_id, ciphertext, wrapped_data_key, key_id)
       values ($1, $2, $3, decode('00', 'hex'), decode('00', 'hex'), 'k')`,
      [ids.secretA, orgA, ids.endpointA],
    );
    await owner.query(
      `insert into api_keys (id, organization_id, application_id, name, prefix, key_hash, scopes)
       values ($1, $2, $3, 'k', 'slm_xxxxxxxx', $4, '{messages:write}')`,
      [ids.keyA, orgA, ids.appA, 'a'.repeat(64)],
    );
  });

  afterAll(async () => {
    await owner.end();
    await runtime.end();
  });

  it('connects as a role that RLS applies to', async () => {
    await expect(assertRowLevelSecurityEnforced(runtime)).resolves.toBeUndefined();
  });

  it.each(TABLES)('%s: no tenant context means no rows', async (table) => {
    const { rows } = await runtime.query(`select count(*)::int as n from ${table}`);
    expect(rows[0].n).toBe(0);
  });

  it.each(TABLES)('%s: a tenant sees only its own rows', async (table) => {
    const own = await asTenant(orgA, (c) => c.query(`select organization_id from ${table}`));
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every((row) => row.organization_id === orgA)).toBe(true);
    const other = await asTenant(orgB, (c) => c.query(`select organization_id from ${table}`));
    expect(other.rows.every((row) => row.organization_id === orgB)).toBe(true);
  });

  it('a tenant cannot change or remove the rows of another tenant', async () => {
    const changed = await asTenant(orgB, (c) =>
      c.query(`update applications set name = 'x' where id = $1`, [ids.appA]),
    );
    expect(changed.rowCount).toBe(0);
    const removed = await asTenant(orgB, (c) =>
      c.query(`delete from endpoints where id = $1`, [ids.endpointA]),
    );
    expect(removed.rowCount).toBe(0);
    const still = await owner.query(`select name from applications where id = $1`, [ids.appA]);
    expect(still.rows[0].name).toBe('App');
  });

  it('a tenant cannot write a row that claims another organization', async () => {
    await expect(
      asTenant(orgB, (c) =>
        c.query(`insert into applications (id, organization_id, name) values ($1, $2, 'Forged')`, [
          uuidv7(),
          orgA,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('composite foreign keys refuse cross-tenant references, even for the owner role', async () => {
    await expect(
      owner.query(
        `insert into endpoints (id, organization_id, application_id, url)
         values ($1, $2, $3, 'https://example.com')`,
        [uuidv7(), orgB, ids.appA],
      ),
    ).rejects.toThrow(/endpoints_application_fk/);
    await expect(
      owner.query(
        `insert into endpoint_event_types (organization_id, endpoint_id, event_type_id)
         values ($1, $2, $3)`,
        [orgB, ids.endpointB, ids.typeA],
      ),
    ).rejects.toThrow(/endpoint_event_types_event_type_fk/);
    await expect(
      owner.query(
        `insert into api_keys (id, organization_id, application_id, name, prefix, key_hash, scopes)
         values ($1, $2, $3, 'k', 'slm_yyyyyyyy', $4, '{messages:write}')`,
        [uuidv7(), orgB, ids.appA, 'b'.repeat(64)],
      ),
    ).rejects.toThrow(/api_keys_application_fk/);
    await expect(
      owner.query(
        `insert into messages (id, organization_id, application_id, event_type_id, payload, payload_bytes, idempotency_key)
         values ($1, $2, $3, $4, '{}', 2, 'x')`,
        [uuidv7(), orgB, ids.appB, ids.typeA],
      ),
    ).rejects.toThrow(/messages_event_type_fk/);
    await expect(
      owner.query(
        `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id)
         values ($1, $2, $3, $4, $5)`,
        [uuidv7(), orgB, ids.appB, ids.messageA, ids.endpointB],
      ),
    ).rejects.toThrow(/deliveries_message_fk/);
    await expect(
      owner.query(
        `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id)
         values ($1, $2, $3, $4, $5)`,
        [uuidv7(), orgB, ids.appB, ids.messageB, ids.endpointA],
      ),
    ).rejects.toThrow(/deliveries_endpoint_fk/);
  });

  it('allows only one delivery per message and endpoint', async () => {
    await expect(
      owner.query(
        `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id)
         values ($1, $2, $3, $4, $5)`,
        [uuidv7(), orgA, ids.appA, ids.messageA, ids.endpointA],
      ),
    ).rejects.toThrow(/deliveries_message_endpoint_key/);
  });
});
