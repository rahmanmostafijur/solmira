import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, createEndpoint, createEventType } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('endpoints', () => {
  let t: TestApp;
  let admin: Actor;
  let manager: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    const org = newOrganizationId();
    admin = await t.actor(org, 'ADMIN');
    manager = await t.actor(org, 'MANAGER');
  });
  afterAll(() => t.close());

  it('creates with subscriptions, returns the secret once, and never on reads', async () => {
    const app = await createApplication(t, admin, 'Endpoints');
    const eventType = await createEventType(t, admin, 'user.created');
    const created = await createEndpoint(t, manager, app.id, {
      description: 'Acme',
      rateLimitPerSecond: 5,
      headers: { 'x-tenant': 'acme' },
      eventTypeIds: [eventType.id],
    });
    expect(created.signingSecret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);

    const base = '/api/v1/applications/' + app.id + '/endpoints';
    const read = await t
      .http()
      .get(base + '/' + created.id)
      .set(admin.auth)
      .expect(200);
    expect(read.body).toMatchObject({
      enabled: true,
      rateLimitPerSecond: 5,
      headers: { 'x-tenant': 'acme' },
      eventTypeIds: [eventType.id],
    });
    const list = await t.http().get(base).set(admin.auth).expect(200);
    for (const body of [read.body, list.body])
      expect(JSON.stringify(body)).not.toContain(created.signingSecret);
    expect(read.body.signingSecret).toBeUndefined();
  });

  it('updates, disables, changes subscriptions and archives idempotently', async () => {
    const app = await createApplication(t, admin, 'Updates');
    const eventType = await createEventType(t, admin, 'order.shipped');
    const endpoint = await createEndpoint(t, admin, app.id);
    const base = '/api/v1/applications/' + app.id + '/endpoints/' + endpoint.id;

    const disabled = await t
      .http()
      .patch(base)
      .set(manager.auth)
      .send({ enabled: false })
      .expect(200);
    expect(disabled.body).toMatchObject({ enabled: false, disabledReason: 'manual' });
    const enabled = await t
      .http()
      .patch(base)
      .set(manager.auth)
      .send({ enabled: true, eventTypeIds: [eventType.id], rateLimitPerSecond: null })
      .expect(200);
    expect(enabled.body).toMatchObject({
      enabled: true,
      disabledReason: null,
      eventTypeIds: [eventType.id],
    });

    await t.http().delete(base).set(manager.auth).expect(204);
    await t.http().delete(base).set(manager.auth).expect(204);
    await t.http().patch(base).set(manager.auth).send({ enabled: true }).expect(404);
    const archived = await t.http().get(base).set(manager.auth).expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
  });

  it('rejects archived and unknown subscriptions with a field error', async () => {
    const app = await createApplication(t, admin, 'Subscriptions');
    const archived = await createEventType(t, admin, 'old.event');
    await t
      .http()
      .post('/api/v1/event-types/' + archived.id + '/archive')
      .set(admin.auth)
      .expect(200);
    const response = await t
      .http()
      .post('/api/v1/applications/' + app.id + '/endpoints')
      .set(admin.auth)
      .send({ url: 'https://hooks.example.com/h', eventTypeIds: [archived.id] })
      .expect(400);
    expect(response.body.error.details[0].path).toBe('eventTypeIds.0');
  });

  it('rejects headers that would break the protocol or the signature', async () => {
    const app = await createApplication(t, admin, 'Headers');
    const response = await t
      .http()
      .post('/api/v1/applications/' + app.id + '/endpoints')
      .set(admin.auth)
      .send({ url: 'https://hooks.example.com/h', headers: { 'webhook-signature': 'forged' } })
      .expect(400);
    expect(response.body.error.details[0].message).toContain('cannot be overridden');
  });
});
