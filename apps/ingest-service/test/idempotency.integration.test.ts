import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendMessage } from './support/ingestion.js';
import { createApiKey, createApplication, createEventType } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('ingestion idempotency', () => {
  let t: TestApp;
  let admin: Actor;
  let appId: string;
  let eventType: string;
  let key: string;

  beforeAll(async () => {
    t = await createTestApp({ IDEMPOTENCY_RETENTION_SECONDS: '3600' });
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    appId = (await createApplication(t, admin, 'Idempotency')).id;
    eventType = (await createEventType(t, admin, 'invoice.paid')).name;
    key = (await createApiKey(t, admin, appId)).key;
  });
  afterAll(() => t.close());

  const send = (body: object, idempotencyKey: string) =>
    sendMessage(t, appId, key, body, idempotencyKey);
  const countMessages = async () =>
    (await t.db.query('select count(*)::int as n from messages where application_id = $1', [appId]))
      .rows[0].n as number;

  it('returns the original message for a retry with the same key and body', async () => {
    const idempotencyKey = randomUUID();
    const before = await countMessages();
    const first = await send({ eventType, payload: { a: 1, b: { c: 2 } } }, idempotencyKey).expect(
      202,
    );
    const second = await send({ eventType, payload: { b: { c: 2 }, a: 1 } }, idempotencyKey).expect(
      200,
    );
    expect(second.body).toEqual(first.body);
    expect((await countMessages()) - before).toBe(1);
    const events = await t.db.query(
      `select count(*)::int as n from outbox_events where payload->>'messageId' = $1`,
      [first.body.id],
    );
    expect(events.rows[0].n).toBe(1);
  });

  it('rejects the same key with a different payload or event type, and keeps the original', async () => {
    const idempotencyKey = randomUUID();
    const first = await send({ eventType, payload: { a: 1 } }, idempotencyKey).expect(202);
    const changed = await send({ eventType, payload: { a: 2 } }, idempotencyKey).expect(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const other = await createEventType(t, admin, 'other.event');
    await send({ eventType: other.name, payload: { a: 1 } }, idempotencyKey).expect(409);
    const replay = await send({ eventType, payload: { a: 1 } }, idempotencyKey).expect(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('keeps keys separate per application', async () => {
    const otherApp = await createApplication(t, admin, 'Second application');
    const otherKey = await createApiKey(t, admin, otherApp.id);
    const idempotencyKey = randomUUID();
    const a = await send({ eventType, payload: { n: 1 } }, idempotencyKey).expect(202);
    const b = await sendMessage(
      t,
      otherApp.id,
      otherKey.key,
      { eventType, payload: { n: 1 } },
      idempotencyKey,
    ).expect(202);
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('does not consume the key when the request is rejected', async () => {
    const typed = await t
      .http()
      .post('/api/v1/event-types')
      .set(admin.auth)
      .send({ name: 'needs.id', schema: { type: 'object', required: ['id'] } })
      .expect(201);
    const idempotencyKey = randomUUID();
    await send({ eventType: typed.body.name, payload: {} }, idempotencyKey).expect(422);
    await send({ eventType: typed.body.name, payload: { id: 'x' } }, idempotencyKey).expect(202);
  });

  it('forgets a key after the retention window and accepts it again', async () => {
    const idempotencyKey = randomUUID();
    const first = await send({ eventType, payload: { v: 1 } }, idempotencyKey).expect(202);
    const stored = await t.db.query(
      'select expires_at, created_at from idempotency_keys where application_id = $1 and key = $2',
      [appId, idempotencyKey],
    );
    const lifetime = stored.rows[0].expires_at.getTime() - stored.rows[0].created_at.getTime();
    expect(Math.abs(lifetime - 3600 * 1000)).toBeLessThan(5_000);

    await t.db.query(
      `update idempotency_keys set expires_at = now() - interval '1 second' where application_id = $1 and key = $2`,
      [appId, idempotencyKey],
    );
    const again = await send({ eventType, payload: { v: 2 } }, idempotencyKey).expect(202);
    expect(again.body.id).not.toBe(first.body.id);
    const replay = await send({ eventType, payload: { v: 2 } }, idempotencyKey).expect(200);
    expect(replay.body.id).toBe(again.body.id);
  });

  it('creates exactly one message when the same request arrives many times at once', async () => {
    const idempotencyKey = randomUUID();
    const before = await countMessages();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        send({ eventType, payload: { race: true } }, idempotencyKey),
      ),
    );
    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(11);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect((await countMessages()) - before).toBe(1);
  });

  it('lets exactly one of several different requests win a key', async () => {
    const idempotencyKey = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        send({ eventType, payload: { contender: i } }, idempotencyKey),
      ),
    );
    expect(responses.filter((r) => r.status === 202)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(5);
  });

  it('removes expired keys in the maintenance pass and keeps live ones', async () => {
    const expired = randomUUID();
    const live = randomUUID();
    await send({ eventType, payload: { m: 1 } }, expired).expect(202);
    await send({ eventType, payload: { m: 2 } }, live).expect(202);
    await t.db.query(
      `update idempotency_keys set expires_at = now() - interval '1 hour' where key = $1`,
      [expired],
    );
    const { MaintenanceService } = await import('../src/maintenance.service.js');
    const result = await t.app.get(MaintenanceService).runOnce();
    expect(result.idempotencyKeys).toBeGreaterThanOrEqual(1);
    const remaining = await t.db.query('select key from idempotency_keys where key = any($1)', [
      [expired, live],
    ]);
    expect(remaining.rows.map((row) => row.key)).toEqual([live]);
  });
});
