import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, createEndpoint, createEventType } from './support/resources.js';
import { seedDelivery } from './support/seed.js';
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

  it('restores idempotently, keeping the URL, the enabled flag and failed deliveries', async () => {
    const app = await createApplication(t, admin, 'Restores');
    const eventType = await createEventType(t, admin, 'invoice.voided');
    const endpoint = await createEndpoint(t, admin, app.id, {
      url: 'https://hooks.example.com/restored',
      enabled: false,
      eventTypeIds: [eventType.id],
    });
    const base = '/api/v1/applications/' + app.id + '/endpoints/' + endpoint.id;
    const failed = await seedDelivery(
      t.db,
      {
        organizationId: admin.organizationId,
        applicationId: app.id,
        endpointId: endpoint.id,
        eventTypeId: eventType.id,
      },
      { status: 'failed', attemptCount: 3 },
    );
    await t.http().delete(base).set(manager.auth).expect(204);

    const restore = () =>
      t
        .http()
        .post(base + '/restore')
        .set(manager.auth)
        .expect(200);
    const first = await restore();
    expect(first.body).toMatchObject({
      url: 'https://hooks.example.com/restored',
      enabled: false,
      disabledReason: 'manual',
      eventTypeIds: [eventType.id],
      archivedAt: null,
    });
    const second = await restore();
    expect(second.body.updatedAt).toBe(first.body.updatedAt);
    await t.http().patch(base).set(manager.auth).send({ description: 'Back' }).expect(200);

    const delivery = await t.db.query(
      'select status, attempt_count from deliveries where id = $1',
      [failed],
    );
    expect(delivery.rows[0]).toEqual({ status: 'failed', attempt_count: 3 });
    const { rows } = await t.db.query(
      `select actor_id, payload from outbox_events
        where type = 'endpoint.restored' and payload->>'endpointId' = $1`,
      [endpoint.id],
    );
    expect(rows).toEqual([
      { actor_id: manager.userId, payload: { endpointId: endpoint.id, applicationId: app.id } },
    ]);
  });

  it('checks the URL policy again on restore and stays archived when it fails', async () => {
    const app = await createApplication(t, admin, 'Rebinding');
    t.dns.set('rebinding.example.com', '93.184.216.34');
    const endpoint = await createEndpoint(t, admin, app.id, {
      url: 'https://rebinding.example.com/hook',
    });
    const base = '/api/v1/applications/' + app.id + '/endpoints/' + endpoint.id;
    await t.http().delete(base).set(admin.auth).expect(204);

    t.dns.set('rebinding.example.com', '10.0.0.7');
    const refused = await t
      .http()
      .post(base + '/restore')
      .set(admin.auth)
      .expect(400);
    expect(refused.body.error.details[0].path).toBe('url');
    const still = await t.http().get(base).set(admin.auth).expect(200);
    expect(still.body.archivedAt).not.toBeNull();
    const events = await t.db.query(
      `select count(*)::int as n from outbox_events
        where type = 'endpoint.restored' and payload->>'endpointId' = $1`,
      [endpoint.id],
    );
    expect(events.rows[0].n).toBe(0);
  });

  it('restores only for roles that can archive, and not into an archived application', async () => {
    const app = await createApplication(t, admin, 'Restore roles');
    const endpoint = await createEndpoint(t, admin, app.id);
    const base = '/api/v1/applications/' + app.id + '/endpoints/' + endpoint.id;
    await t.http().delete(base).set(admin.auth).expect(204);

    const staff = await t.actor(admin.organizationId, 'STAFF');
    await t
      .http()
      .post(base + '/restore')
      .set(staff.auth)
      .expect(403);
    await t
      .http()
      .post(base + '/restore')
      .expect(401);
    await t
      .http()
      .post('/api/v1/applications/' + app.id + '/archive')
      .set(admin.auth)
      .expect(200);
    await t
      .http()
      .post(base + '/restore')
      .set(admin.auth)
      .expect(404);
    const still = await t.http().get(base).set(admin.auth).expect(200);
    expect(still.body.archivedAt).not.toBeNull();
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
