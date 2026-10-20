import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey, createApplication } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('API keys', () => {
  let t: TestApp;
  let admin: Actor;
  let manager: Actor;
  let viewer: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    const org = newOrganizationId();
    admin = await t.actor(org, 'ADMIN');
    manager = await t.actor(org, 'MANAGER');
    viewer = await t.actor(org, 'VIEWER');
  });
  afterAll(() => t.close());

  it('shows the key once, stores a digest, lists without it, and revokes idempotently', async () => {
    const app = await createApplication(t, admin, 'Keys');
    const created = await createApiKey(t, admin, app.id, { scopes: ['messages:write'] });
    expect(created.key).toMatch(/^slm_[A-Za-z0-9_-]{43}$/);
    expect(created.key.startsWith(created.prefix)).toBe(true);

    const base = '/api/v1/applications/' + app.id + '/api-keys';
    const listed = await t.http().get(base).set(manager.auth).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.key);

    const stored = await t.db.query('select key_hash from api_keys where id = $1', [created.id]);
    expect(stored.rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);

    await t
      .http()
      .delete(base + '/' + created.id)
      .set(admin.auth)
      .expect(204);
    await t
      .http()
      .delete(base + '/' + created.id)
      .set(admin.auth)
      .expect(204);
    const hidden = await t.http().get(base).set(admin.auth).expect(200);
    expect(hidden.body.items).toHaveLength(0);
    const revoked = await t
      .http()
      .get(base + '?includeRevoked=true')
      .set(admin.auth)
      .expect(200);
    expect(revoked.body.items[0].revokedAt).not.toBeNull();
  });

  it('limits who can create, read and revoke keys', async () => {
    const app = await createApplication(t, admin, 'Key roles');
    const base = '/api/v1/applications/' + app.id + '/api-keys';
    await t.http().post(base).set(manager.auth).send({ name: 'x' }).expect(403);
    await t.http().get(base).set(viewer.auth).expect(403);
    await t.http().get(base).set(manager.auth).expect(200);
  });

  it('rejects unknown scopes and past expiry times', async () => {
    const app = await createApplication(t, admin, 'Key validation');
    const base = '/api/v1/applications/' + app.id + '/api-keys';
    await t
      .http()
      .post(base)
      .set(admin.auth)
      .send({ name: 'x', scopes: ['root'] })
      .expect(400);
    await t
      .http()
      .post(base)
      .set(admin.auth)
      .send({ name: 'x', expiresAt: '2020-01-01T00:00:00Z' })
      .expect(400);
  });
});
