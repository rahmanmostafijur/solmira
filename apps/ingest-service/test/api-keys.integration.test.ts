import { randomUUID } from 'node:crypto';
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

  it('renames a key, keeps everything else, and records the change without the key', async () => {
    const app = await createApplication(t, admin, 'Rename');
    const created = await createApiKey(t, admin, app.id, {
      name: 'ci',
      scopes: ['messages:write', 'messages:read'],
    });
    const path = '/api/v1/applications/' + app.id + '/api-keys/' + created.id;

    const renamed = await t
      .http()
      .patch(path)
      .set(admin.auth)
      .send({ name: '  deploy bot ' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      id: created.id,
      name: 'deploy bot',
      prefix: created.prefix,
      scopes: ['messages:write', 'messages:read'],
      revokedAt: null,
    });
    expect(renamed.body.key).toBeUndefined();

    const { rows } = await t.db.query(
      `select actor_id, payload, payload::text as text from outbox_events
        where type = 'api_key.updated' and payload->>'apiKeyId' = $1`,
      [created.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(admin.userId);
    expect(rows[0].payload).toEqual({
      apiKeyId: created.id,
      applicationId: app.id,
      fields: ['name'],
    });
    expect(rows[0].text).not.toContain(created.key);
  });

  it('refuses to rename a revoked key, and accepts a new name only', async () => {
    const app = await createApplication(t, admin, 'Rename rules');
    const created = await createApiKey(t, admin, app.id);
    const path = '/api/v1/applications/' + app.id + '/api-keys/' + created.id;

    await t
      .http()
      .patch(path)
      .set(admin.auth)
      .send({ name: 'ci', scopes: ['messages:read'] })
      .expect(400);
    await t.http().patch(path).set(admin.auth).send({}).expect(400);
    const unchanged = await t.db.query('select name, scopes from api_keys where id = $1', [
      created.id,
    ]);
    expect(unchanged.rows[0]).toEqual({ name: 'ci', scopes: ['messages:write'] });

    await t.http().delete(path).set(admin.auth).expect(204);
    const refused = await t.http().patch(path).set(admin.auth).send({ name: 'late' }).expect(409);
    expect(refused.body.error.code).toBe('CONFLICT');
    await t
      .http()
      .patch('/api/v1/applications/' + app.id + '/api-keys/' + randomUUID())
      .set(admin.auth)
      .send({ name: 'ghost' })
      .expect(404);
  });

  it('limits who can create, read, rename and revoke keys', async () => {
    const app = await createApplication(t, admin, 'Key roles');
    const base = '/api/v1/applications/' + app.id + '/api-keys';
    await t.http().post(base).set(manager.auth).send({ name: 'x' }).expect(403);
    await t.http().get(base).set(viewer.auth).expect(403);
    await t.http().get(base).set(manager.auth).expect(200);

    const key = await createApiKey(t, admin, app.id);
    for (const actor of [manager, viewer])
      await t
        .http()
        .patch(base + '/' + key.id)
        .set(actor.auth)
        .send({ name: 'x' })
        .expect(403);
    await t
      .http()
      .patch(base + '/' + key.id)
      .send({ name: 'x' })
      .expect(401);
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
