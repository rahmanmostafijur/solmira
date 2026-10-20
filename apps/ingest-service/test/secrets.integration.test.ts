import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, createEndpoint } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('signing secrets', () => {
  let t: TestApp;
  let admin: Actor;
  let manager: Actor;
  let appId: string;
  let endpoint: { id: string; signingSecret: string };
  let reveal: string;

  beforeAll(async () => {
    t = await createTestApp();
    const org = newOrganizationId();
    admin = await t.actor(org, 'ADMIN');
    manager = await t.actor(org, 'MANAGER');
    appId = (await createApplication(t, admin)).id;
    endpoint = await createEndpoint(t, manager, appId);
    reveal = '/api/v1/applications/' + appId + '/endpoints/' + endpoint.id + '/secret/reveal';
  });
  afterAll(() => t.close());

  it('stores only ciphertext: neither the secret nor a key appears in the database', async () => {
    const { rows } = await t.db.query(
      'select ciphertext, wrapped_data_key, key_id, status from endpoint_secrets where endpoint_id = $1',
      [endpoint.id],
    );
    expect(rows).toHaveLength(1);
    const plaintext = Buffer.from(endpoint.signingSecret, 'utf8');
    expect(rows[0].ciphertext.includes(plaintext)).toBe(false);
    expect(rows[0].wrapped_data_key.includes(plaintext)).toBe(false);
    expect(rows[0]).toMatchObject({ key_id: 'local-1', status: 'active' });

    const dump = await t.db.query(
      'select to_jsonb(e)::text as row from endpoints e where id = $1',
      [endpoint.id],
    );
    expect(dump.rows[0].row).not.toContain(endpoint.signingSecret);
  });

  it('reveals the same secret to an admin, and only to roles holding the permission', async () => {
    const revealed = await t.http().post(reveal).set(admin.auth).expect(200);
    expect(revealed.body).toEqual({ secret: endpoint.signingSecret });
    await t.http().post(reveal).set(manager.auth).expect(403);
    await t.http().post(reveal).expect(401);
    const viewer = await t.actor(admin.organizationId, 'VIEWER');
    await t.http().post(reveal).set(viewer.auth).expect(403);
  });

  it('audits every reveal in the outbox, without the secret', async () => {
    const before = await t.db.query(
      `select count(*)::int as n from outbox_events where type = 'endpoint_secret.revealed'`,
    );
    await t.http().post(reveal).set(admin.auth).expect(200);
    await t.http().post(reveal).set(admin.auth).expect(200);
    const { rows } = await t.db.query(
      `select actor_id, organization_id, payload::text as payload from outbox_events
        where type = 'endpoint_secret.revealed' order by occurred_at desc limit 2`,
    );
    const after = await t.db.query(
      `select count(*)::int as n from outbox_events where type = 'endpoint_secret.revealed'`,
    );
    expect(after.rows[0].n - before.rows[0].n).toBe(2);
    for (const row of rows) {
      expect(row.actor_id).toBe(admin.userId);
      expect(row.organization_id).toBe(admin.organizationId);
      expect(row.payload).toContain(endpoint.id);
      expect(row.payload).not.toContain(endpoint.signingSecret);
    }
  });

  it('records no reveal when the request is refused', async () => {
    const before = await t.db.query(`select count(*)::int as n from outbox_events`);
    await t.http().post(reveal).set(manager.auth).expect(403);
    const after = await t.db.query(`select count(*)::int as n from outbox_events`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('cannot reveal the secret of an archived endpoint', async () => {
    const archived = await createEndpoint(t, admin, appId);
    const base = '/api/v1/applications/' + appId + '/endpoints/' + archived.id;
    await t.http().delete(base).set(admin.auth).expect(204);
    await t
      .http()
      .post(base + '/secret/reveal')
      .set(admin.auth)
      .expect(404);
  });
});
