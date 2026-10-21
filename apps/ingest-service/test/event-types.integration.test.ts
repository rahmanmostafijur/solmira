import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('event types', () => {
  let t: TestApp;
  let manager: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.actor(newOrganizationId(), 'MANAGER');
  });
  afterAll(() => t.close());

  const post = (body: object) => t.http().post('/api/v1/event-types').set(manager.auth).send(body);

  it('creates with a payload schema and rejects duplicates and bad names', async () => {
    const created = await post({
      name: 'invoice.paid',
      schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    }).expect(201);
    expect(created.body.schema).toMatchObject({ type: 'object' });

    await post({ name: 'invoice.paid' }).expect(409);
    await post({ name: 'Bad Name' }).expect(400);
  });

  it('rejects schemas that do not compile or reach for remote references', async () => {
    const bad = await post({ name: 'bad.schema', schema: { type: 'not-a-type' } }).expect(400);
    expect(bad.body.error.details[0].path).toBe('schema');
    await post({
      name: 'remote.ref',
      schema: { $ref: 'https://example.com/schema.json' },
    }).expect(400);
  });

  it('updates, clears the schema, and keeps the name reserved after archiving', async () => {
    const created = await post({ name: 'user.deleted', schema: { type: 'object' } }).expect(201);
    const updated = await t
      .http()
      .patch('/api/v1/event-types/' + created.body.id)
      .set(manager.auth)
      .send({ schema: null, description: 'Deleted users' })
      .expect(200);
    expect(updated.body).toMatchObject({ schema: null, description: 'Deleted users' });

    const archive = () =>
      t
        .http()
        .post('/api/v1/event-types/' + created.body.id + '/archive')
        .set(manager.auth);
    const first = await archive().expect(200);
    const second = await archive().expect(200);
    expect(second.body.archivedAt).toBe(first.body.archivedAt);
    await post({ name: 'user.deleted' }).expect(409);

    const hidden = await t.http().get('/api/v1/event-types').set(manager.auth).expect(200);
    expect(hidden.body.items.map((item: { id: string }) => item.id)).not.toContain(created.body.id);
  });

  it('restores idempotently, makes the type subscribable again and records it once', async () => {
    const created = await post({ name: 'refund.issued', schema: { type: 'object' } }).expect(201);
    const path = '/api/v1/event-types/' + created.body.id;
    await t
      .http()
      .post(path + '/archive')
      .set(manager.auth)
      .expect(200);
    const restore = () =>
      t
        .http()
        .post(path + '/restore')
        .set(manager.auth)
        .expect(200);
    const first = await restore();
    expect(first.body).toMatchObject({
      name: 'refund.issued',
      schema: { type: 'object' },
      archivedAt: null,
    });
    const second = await restore();
    expect(second.body.updatedAt).toBe(first.body.updatedAt);

    const listed = await t.http().get('/api/v1/event-types').set(manager.auth).expect(200);
    expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(created.body.id);
    const { rows } = await t.db.query(
      `select actor_id, organization_id from outbox_events
        where type = 'event_type.restored' and payload->>'eventTypeId' = $1`,
      [created.body.id],
    );
    expect(rows).toEqual([{ actor_id: manager.userId, organization_id: manager.organizationId }]);
  });

  it('lets only roles that can archive restore, and 404s an unknown id', async () => {
    const created = await post({ name: 'restore.roles' }).expect(201);
    const path = '/api/v1/event-types/' + created.body.id;
    await t
      .http()
      .post(path + '/archive')
      .set(manager.auth)
      .expect(200);
    const viewer = await t.actor(manager.organizationId, 'VIEWER');
    await t
      .http()
      .post(path + '/restore')
      .set(viewer.auth)
      .expect(403);
    await t
      .http()
      .post(path + '/restore')
      .expect(401);
    await t
      .http()
      .post('/api/v1/event-types/' + randomUUID() + '/restore')
      .set(manager.auth)
      .expect(404);
    const still = await t.http().get(path).set(manager.auth).expect(200);
    expect(still.body.archivedAt).not.toBeNull();
  });
});
