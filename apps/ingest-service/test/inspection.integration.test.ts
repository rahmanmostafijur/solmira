import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDelivery, seedEndpoint, seedOrganization, type DeliverySeed } from './support/seed.js';
import { createTestApp, type Actor, type TestApp } from './support/test-app.js';

describe('message and delivery inspection', () => {
  let t: TestApp;
  let seed: DeliverySeed;
  let viewer: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    seed = await seedOrganization(t.db);
    viewer = await t.actor(seed.organizationId, 'VIEWER');
  });
  afterAll(() => t.close());

  const base = () => '/api/v1/applications/' + seed.applicationId;
  const messageOf = async (deliveryId: string) =>
    (await t.db.query('select message_id from deliveries where id = $1', [deliveryId])).rows[0]
      .message_id as string;
  const attempt = (
    messageId: string,
    deliveryId: string,
    endpointId: string,
    n: number,
    extra = {},
  ) =>
    t.attempts.record({
      organizationId: seed.organizationId,
      messageId,
      endpointId,
      deliveryId,
      attempt: n,
      startedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, n)),
      durationMs: 120,
      statusCode: 500,
      errorClass: 'http_5xx',
      responseBody: 'boom',
      responseBodyTruncated: false,
      nextAttemptAt: new Date(Date.UTC(2026, 9, 1, 12, 5, n)),
      ...extra,
    });

  it('shows a message with its deliveries and the attempt timeline, oldest first', async () => {
    const other = await seedEndpoint(t.db, seed);
    const failed = await seedDelivery(t.db, seed, { status: 'failed', attemptCount: 2 });
    const messageId = await messageOf(failed);
    await t.db.query(
      `insert into deliveries (id, organization_id, application_id, message_id, endpoint_id, status, attempt_count)
       values ($1, $2, $3, $4, $5, 'succeeded', 1)`,
      [randomUUID(), seed.organizationId, seed.applicationId, messageId, other.endpointId],
    );
    await attempt(messageId, failed, seed.endpointId, 2);
    await attempt(messageId, failed, seed.endpointId, 1);

    const response = await t
      .http()
      .get(base() + '/messages/' + messageId)
      .set(viewer.auth)
      .expect(200);
    expect(response.body).toMatchObject({
      id: messageId,
      payload: { seed: true },
      attemptsAvailable: true,
    });
    expect(response.body.deliveries).toHaveLength(2);
    expect(response.body.deliveries.map((d: { status: string }) => d.status).sort()).toEqual([
      'failed',
      'succeeded',
    ]);
    expect(response.body.deliveries[0].endpointUrl).toContain('https://example.com');
    expect(response.body.attempts.map((a: { attempt: number }) => a.attempt)).toEqual([1, 2]);
    expect(response.body.attempts[0]).toMatchObject({
      statusCode: 500,
      errorClass: 'http_5xx',
      responseBody: 'boom',
    });
  });

  it('still shows the deliveries when the attempt history cannot be read', async () => {
    const id = await seedDelivery(t.db, seed, { status: 'failed' });
    const messageId = await messageOf(id);
    const original = t.attempts.listForMessage.bind(t.attempts);
    t.attempts.listForMessage = async () => {
      throw new Error('DynamoDB is down');
    };
    try {
      const response = await t
        .http()
        .get(base() + '/messages/' + messageId)
        .set(viewer.auth)
        .expect(200);
      expect(response.body).toMatchObject({ attempts: [], attemptsAvailable: false });
      expect(response.body.deliveries).toHaveLength(1);
    } finally {
      t.attempts.listForMessage = original;
    }
  });

  it('lists messages newest first with delivery counts, filters and pages', async () => {
    const own = await seedOrganization(t.db);
    const actor = await t.actor(own.organizationId, 'VIEWER');
    for (let i = 0; i < 5; i += 1) {
      const id = await seedDelivery(t.db, own, { status: i % 2 === 0 ? 'failed' : 'succeeded' });
      await t.db.query(
        `update messages set created_at = $2 where id = (select message_id from deliveries where id = $1)`,
        [id, new Date(Date.UTC(2026, 9, 1 + i)).toISOString()],
      );
    }
    const url = '/api/v1/applications/' + own.applicationId + '/messages';
    const all = await t.http().get(url).set(actor.auth).expect(200);
    expect(all.body.total).toBe(5);
    const dates = all.body.items.map((m: { createdAt: string }) => m.createdAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(all.body.items[0].deliveries).toMatchObject({ failed: 1, succeeded: 0 });

    const page = await t
      .http()
      .get(url + '?pageSize=2&page=2')
      .set(actor.auth)
      .expect(200);
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    const ranged = await t
      .http()
      .get(url + '?from=2026-10-02T00:00:00Z&to=2026-10-04T00:00:00Z')
      .set(actor.auth)
      .expect(200);
    expect(ranged.body.total).toBe(2);
    const none = await t
      .http()
      .get(url + '?eventType=nothing.like.this')
      .set(actor.auth)
      .expect(200);
    expect(none.body.total).toBe(0);
    await t
      .http()
      .get(url + '?pageSize=1000')
      .set(actor.auth)
      .expect(400);
  });

  it('lists the deliveries of an endpoint, filtered by status', async () => {
    const target = await seedEndpoint(t.db, seed);
    for (const status of ['failed', 'failed', 'succeeded', 'pending'])
      await seedDelivery(t.db, target, { status });
    const url =
      '/api/v1/applications/' +
      target.applicationId +
      '/endpoints/' +
      target.endpointId +
      '/deliveries';
    expect((await t.http().get(url).set(viewer.auth).expect(200)).body.total).toBe(4);
    const failed = await t
      .http()
      .get(url + '?status=failed')
      .set(viewer.auth)
      .expect(200);
    expect(failed.body.total).toBe(2);
    expect(failed.body.items.every((d: { status: string }) => d.status === 'failed')).toBe(true);
    await t
      .http()
      .get(url + '?status=weird')
      .set(viewer.auth)
      .expect(400);
  });

  it('answers 404 for other organizations and unknown ids, and needs a token', async () => {
    const id = await seedDelivery(t.db, seed, { status: 'failed' });
    const messageId = await messageOf(id);
    const stranger = await t.actor(randomUUID(), 'OWNER');
    await t
      .http()
      .get(base() + '/messages/' + messageId)
      .set(stranger.auth)
      .expect(404);
    await t
      .http()
      .get(base() + '/messages')
      .set(stranger.auth)
      .expect(404);
    await t
      .http()
      .get(base() + '/endpoints/' + seed.endpointId + '/deliveries')
      .set(stranger.auth)
      .expect(404);
    await t
      .http()
      .get(base() + '/messages/' + randomUUID())
      .set(viewer.auth)
      .expect(404);
    await t
      .http()
      .get(base() + '/messages')
      .expect(401);
  });

  it('keeps one organization attempt history invisible to another with the same message id', async () => {
    const id = await seedDelivery(t.db, seed, { status: 'failed' });
    const messageId = await messageOf(id);
    await attempt(messageId, id, seed.endpointId, 1);
    expect(await t.attempts.listForMessage(randomUUID(), messageId)).toEqual([]);
    expect((await t.attempts.listForMessage(seed.organizationId, messageId)).length).toBe(1);
  });
});
