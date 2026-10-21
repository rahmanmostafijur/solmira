import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDelivery, seedEndpoint, seedOrganization, type DeliverySeed } from './support/seed.js';
import { createTestApp, type Actor, type TestApp } from './support/test-app.js';

describe('replaying a message', () => {
  let t: TestApp;
  let seed: DeliverySeed;
  let manager: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    seed = await seedOrganization(t.db);
    manager = await t.actor(seed.organizationId, 'MANAGER');
  });
  afterAll(() => t.close());

  const base = () => '/api/v1/applications/' + seed.applicationId;
  const messageOf = async (deliveryId: string) =>
    (await t.db.query('select message_id from deliveries where id = $1', [deliveryId])).rows[0]
      .message_id as string;
  const row = async (id: string) =>
    (
      await t.db.query('select status, attempt_count, cycle_base from deliveries where id = $1', [
        id,
      ])
    ).rows[0];
  const replay = (messageId: string, body: object = {}) =>
    t
      .http()
      .post(base() + '/messages/' + messageId + '/replay')
      .set(manager.auth)
      .send(body);

  it('puts the finished deliveries of a message back in the queue as a new cycle', async () => {
    const failed = await seedDelivery(t.db, seed, { status: 'failed', attemptCount: 8 });
    const response = await replay(await messageOf(failed)).expect(200);
    expect(response.body).toEqual({ replayed: 1, more: false });
    expect(await row(failed)).toMatchObject({ status: 'pending', attempt_count: 8, cycle_base: 8 });
    const due = await t.db.query(
      'select next_attempt_at <= now() as due from deliveries where id = $1',
      [failed],
    );
    expect(due.rows[0].due).toBe(true);
  });

  it('does nothing the second time, because the delivery is already waiting', async () => {
    const failed = await seedDelivery(t.db, seed, { status: 'failed', attemptCount: 3 });
    const messageId = await messageOf(failed);
    expect((await replay(messageId).expect(200)).body.replayed).toBe(1);
    expect((await replay(messageId).expect(200)).body.replayed).toBe(0);
    expect(await row(failed)).toMatchObject({ status: 'pending', cycle_base: 3 });
  });

  it('can replay a delivery that succeeded, and only the endpoint asked for', async () => {
    const other = await seedEndpoint(t.db, seed);
    const first = await seedDelivery(t.db, seed, { status: 'succeeded', attemptCount: 1 });
    const messageId = await messageOf(first);
    await t.db.query(
      `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id, status, attempt_count)
       values ($1, $2, $3, $4, $5, 'failed', 5)`,
      [randomUUID(), seed.organizationId, seed.applicationId, messageId, other.endpointId],
    );
    const only = await replay(messageId, { endpointId: other.endpointId }).expect(200);
    expect(only.body.replayed).toBe(1);
    expect((await row(first)).status).toBe('succeeded');
  });

  it('refuses disabled endpoints with a conflict, skips them otherwise, and 404s the unknown', async () => {
    const dead = await seedEndpoint(t.db, seed);
    await t.db.query('update endpoints set enabled = false where id = $1', [dead.endpointId]);
    const delivery = await seedDelivery(t.db, dead, { status: 'failed', attemptCount: 2 });
    const messageId = await messageOf(delivery);
    const conflict = await replay(messageId, { endpointId: dead.endpointId }).expect(409);
    expect(conflict.body.error.message).toContain('enable');
    expect((await replay(messageId).expect(200)).body.replayed).toBe(0);
    expect((await row(delivery)).status).toBe('failed');
    await replay(randomUUID()).expect(404);
  });

  it('never replays another organization deliveries, and records an audit event', async () => {
    const stranger = await t.actor(randomUUID(), 'OWNER');
    const failed = await seedDelivery(t.db, seed, { status: 'failed', attemptCount: 1 });
    const messageId = await messageOf(failed);
    await t
      .http()
      .post(base() + '/messages/' + messageId + '/replay')
      .set(stranger.auth)
      .send({})
      .expect(404);
    expect((await row(failed)).status).toBe('failed');
    await replay(messageId).expect(200);
    const events = await t.db.query(
      `select actor_id from outbox_events where type = 'delivery.replayed' and payload->>'messageId' = $1`,
      [messageId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].actor_id).toBe(manager.userId);
  });
});
