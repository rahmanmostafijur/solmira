import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey, createApplication, createEventType } from './support/resources.js';
import { sendMessage } from './support/ingestion.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('message ingestion and API key authentication', () => {
  let t: TestApp;
  let admin: Actor;
  let appId: string;
  let eventType: string;
  let key: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    appId = (await createApplication(t, admin, 'Ingest')).id;
    eventType = (await createEventType(t, admin, 'invoice.paid')).name;
    key = (await createApiKey(t, admin, appId)).key;
  });
  afterAll(() => t.close());

  const valid = (extra: object = {}) => ({
    eventType,
    payload: { id: 'inv_1', amount: 5 },
    ...extra,
  });

  it('accepts a message, stores it with its outbox event, and answers 202', async () => {
    const response = await sendMessage(t, appId, key, valid()).expect(202);
    expect(response.body).toMatchObject({ applicationId: appId, eventType });
    const stored = await t.db.query('select payload, payload_bytes from messages where id = $1', [
      response.body.id,
    ]);
    expect(stored.rows[0].payload).toEqual({ id: 'inv_1', amount: 5 });
    expect(stored.rows[0].payload_bytes).toBe(JSON.stringify({ id: 'inv_1', amount: 5 }).length);
    const events = await t.db.query(
      `select organization_id, actor_id, payload from outbox_events
        where type = 'message.created' and payload->>'messageId' = $1`,
      [response.body.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ organization_id: admin.organizationId, actor_id: null });
    expect(JSON.stringify(events.rows[0].payload)).not.toContain('inv_1');
  });

  it('answers 401 without a key, with a malformed key and with an unknown key', async () => {
    const url = '/api/v1/applications/' + appId + '/messages';
    await t.http().post(url).set('Idempotency-Key', 'key-0000001').send(valid()).expect(401);
    await sendMessage(t, appId, 'not-a-key', valid()).expect(401);
    await sendMessage(t, appId, 'slm_' + 'A'.repeat(43), valid()).expect(401);
    await t
      .http()
      .post(url)
      .set('Authorization', 'Basic abc')
      .set('Idempotency-Key', 'key-0000002')
      .send(valid())
      .expect(401);
  });

  it('does not accept a console token as an API key', async () => {
    await sendMessage(t, appId, admin.auth.Authorization.slice(7), valid()).expect(401);
  });

  it('answers 401 for a revoked key and 403 for a key without the write scope', async () => {
    const revoked = await createApiKey(t, admin, appId);
    const keyUrl = '/api/v1/applications/' + appId + '/api-keys/' + revoked.id;
    await t.http().delete(keyUrl).set(admin.auth).expect(204);
    await sendMessage(t, appId, revoked.key, valid()).expect(401);
    const readOnly = await createApiKey(t, admin, appId, { scopes: ['messages:read'] });
    await sendMessage(t, appId, readOnly.key, valid()).expect(403);
  });

  it('answers 404 when the key belongs to another application, even of the same organization', async () => {
    const other = await createApplication(t, admin, 'Other app');
    await sendMessage(t, other.id, key, valid()).expect(404);
  });

  it('answers 404 for a key of another organization', async () => {
    const intruder = await t.actor(newOrganizationId(), 'OWNER');
    const intruderApp = await createApplication(t, intruder, 'Intruder');
    const intruderKey = await createApiKey(t, intruder, intruderApp.id);
    await sendMessage(t, appId, intruderKey.key, valid()).expect(404);
  });

  it('stops accepting messages once the application is archived', async () => {
    const archivable = await createApplication(t, admin, 'Archivable');
    const archivableKey = await createApiKey(t, admin, archivable.id);
    await sendMessage(t, archivable.id, archivableKey.key, valid()).expect(202);
    await t
      .http()
      .post('/api/v1/applications/' + archivable.id + '/archive')
      .set(admin.auth)
      .expect(200);
    await sendMessage(t, archivable.id, archivableKey.key, valid()).expect(401);
  });
});
