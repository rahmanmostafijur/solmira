import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, createEndpoint } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('test send', () => {
  let t: TestApp;
  let admin: Actor;
  let manager: Actor;
  let viewer: Actor;
  let appId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const org = newOrganizationId();
    admin = await t.actor(org, 'ADMIN');
    manager = await t.actor(org, 'MANAGER');
    viewer = await t.actor(org, 'VIEWER');
    appId = (await createApplication(t, admin)).id;
  });
  afterAll(() => t.close());

  const url = (endpointId: string) =>
    '/api/v1/applications/' + appId + '/endpoints/' + endpointId + '/test';

  it('creates one pending delivery to that endpoint only, with no fan-out to the others', async () => {
    const target = await createEndpoint(t, admin, appId);
    const bystander = await createEndpoint(t, admin, appId);
    const response = await t.http().post(url(target.id)).set(manager.auth).expect(202);
    expect(response.body).toEqual({
      messageId: expect.any(String),
      deliveryId: expect.any(String),
    });

    const deliveries = await t.db.query(
      'select endpoint_id, status, attempt_count from deliveries where message_id = $1',
      [response.body.messageId],
    );
    expect(deliveries.rows).toEqual([
      { endpoint_id: target.id, status: 'pending', attempt_count: 0 },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 600)); // time for any fan-out to act
    const others = await t.db.query(
      'select count(*)::int as n from deliveries where endpoint_id = $1',
      [bystander.id],
    );
    expect(others.rows[0].n).toBe(0);
    const events = await t.db.query(
      `select type from outbox_events where payload->>'messageId' = $1`,
      [response.body.messageId],
    );
    expect(events.rows.map((r) => r.type)).toEqual(['endpoint.test_sent']);
  });

  it('shows up in the message list under the platform event type, created once per organization', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    await t.http().post(url(endpoint.id)).set(manager.auth).expect(202);
    await t.http().post(url(endpoint.id)).set(manager.auth).expect(202);
    const list = await t
      .http()
      .get('/api/v1/applications/' + appId + '/messages?eventType=solmira.test')
      .set(viewer.auth)
      .expect(200);
    expect(list.body.total).toBeGreaterThanOrEqual(2);
    expect(list.body.items[0].eventType).toBe('solmira.test');
    const types = await t.db.query(
      `select count(*)::int as n from event_types where organization_id = $1 and name = 'solmira.test'`,
      [admin.organizationId],
    );
    expect(types.rows[0].n).toBe(1);
  });

  it('carries a recognizable payload', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    const response = await t.http().post(url(endpoint.id)).set(manager.auth).expect(202);
    const detail = await t
      .http()
      .get('/api/v1/applications/' + appId + '/messages/' + response.body.messageId)
      .set(viewer.auth)
      .expect(200);
    expect(detail.body.payload).toMatchObject({ type: 'solmira.test' });
    expect(detail.body.deliveries).toHaveLength(1);
  });

  it('refuses disabled, archived and unknown endpoints, other organizations and viewers', async () => {
    const disabled = await createEndpoint(t, admin, appId);
    await t
      .http()
      .patch('/api/v1/applications/' + appId + '/endpoints/' + disabled.id)
      .set(manager.auth)
      .send({ enabled: false })
      .expect(200);
    await t.http().post(url(disabled.id)).set(manager.auth).expect(409);
    const archived = await createEndpoint(t, admin, appId);
    await t
      .http()
      .delete('/api/v1/applications/' + appId + '/endpoints/' + archived.id)
      .set(manager.auth)
      .expect(204);
    await t.http().post(url(archived.id)).set(manager.auth).expect(404);
    await t.http().post(url(randomUUID())).set(manager.auth).expect(404);
    const live = await createEndpoint(t, admin, appId);
    await t.http().post(url(live.id)).set(viewer.auth).expect(403);
    const stranger = await t.actor(newOrganizationId(), 'OWNER');
    await t.http().post(url(live.id)).set(stranger.auth).expect(404);
    await t.http().post(url(live.id)).expect(401);
  });

  it('keeps the solmira. prefix for the platform', async () => {
    const response = await t
      .http()
      .post('/api/v1/event-types')
      .set(admin.auth)
      .send({ name: 'solmira.custom' })
      .expect(400);
    expect(response.body.error.details[0].message).toContain('reserved');
  });
});
