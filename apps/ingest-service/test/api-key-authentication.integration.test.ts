import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ApiKeyAuthenticator } from '../src/api-keys/api-key-authenticator.js';
import { createApiKey, createApplication } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('API key authentication', () => {
  let t: TestApp;
  let admin: Actor;
  let authenticator: ApiKeyAuthenticator;
  let app: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    authenticator = t.app.get(ApiKeyAuthenticator);
    app = await createApplication(t, admin);
  });
  afterAll(() => t.close());

  const keysPath = () => '/api/v1/applications/' + app.id + '/api-keys';

  it('resolves a valid key to its organization, application and scopes', async () => {
    const created = await createApiKey(t, admin, app.id, {
      scopes: ['messages:write', 'messages:read'],
    });
    await expect(authenticator.authenticate(created.key)).resolves.toEqual({
      apiKeyId: created.id,
      organizationId: admin.organizationId,
      applicationId: app.id,
      scopes: ['messages:write', 'messages:read'],
    });
  });

  it('rejects unknown, malformed and altered keys', async () => {
    const created = await createApiKey(t, admin, app.id);
    const altered = created.key.slice(0, -1) + (created.key.endsWith('A') ? 'B' : 'A');
    for (const presented of [altered, '', 'slm_short', 'Bearer ' + created.key, 'x'.repeat(200)])
      await expect(authenticator.authenticate(presented), presented).resolves.toBeNull();
  });

  it('stops accepting a key as soon as it is revoked', async () => {
    const created = await createApiKey(t, admin, app.id);
    await expect(authenticator.authenticate(created.key)).resolves.not.toBeNull();
    await t
      .http()
      .delete(keysPath() + '/' + created.id)
      .set(admin.auth)
      .expect(204);
    await expect(authenticator.authenticate(created.key)).resolves.toBeNull();
  });

  it('refuses expired keys and keys of archived applications', async () => {
    const expiring = await createApiKey(t, admin, app.id);
    await t.db.query(`update api_keys set expires_at = now() - interval '1 second' where id = $1`, [
      expiring.id,
    ]);
    await expect(authenticator.authenticate(expiring.key)).resolves.toBeNull();

    const other = await createApplication(t, admin, 'Soon archived');
    const key = await createApiKey(t, admin, other.id);
    await expect(authenticator.authenticate(key.key)).resolves.not.toBeNull();
    await t
      .http()
      .post('/api/v1/applications/' + other.id + '/archive')
      .set(admin.auth)
      .expect(200);
    await expect(authenticator.authenticate(key.key)).resolves.toBeNull();
  });

  it('records the last use, at most once a minute', async () => {
    const created = await createApiKey(t, admin, app.id);
    const lastUsed = async () =>
      (await t.db.query('select last_used_at from api_keys where id = $1', [created.id])).rows[0]
        .last_used_at as Date | null;
    expect(await lastUsed()).toBeNull();

    await authenticator.authenticate(created.key);
    const first = await lastUsed();
    expect(first).toBeInstanceOf(Date);

    await authenticator.authenticate(created.key);
    expect(await lastUsed()).toEqual(first);

    await t.db.query(
      `update api_keys set last_used_at = now() - interval '2 minutes' where id = $1`,
      [created.id],
    );
    await authenticator.authenticate(created.key);
    const refreshed = await lastUsed();
    expect(refreshed!.getTime()).toBeGreaterThan(first!.getTime() - 1);
    expect(Date.now() - refreshed!.getTime()).toBeLessThan(60_000);
  });

  it('keeps the key table itself invisible to the runtime role without a tenant', async () => {
    const created = await createApiKey(t, admin, app.id);
    const hit = await t.db.query('select count(*)::int as n from api_keys where id = $1', [
      created.id,
    ]);
    expect(hit.rows[0].n).toBe(1);
    // As the runtime role, the table itself shows nothing without a tenant context.
    const runtime = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });
    const bare = await runtime.query('select count(*)::int as n from api_keys');
    await runtime.end();
    expect(bare.rows[0].n).toBe(0);
  });
});
