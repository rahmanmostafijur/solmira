import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDelivery, seedEndpoint, seedOrganization, type DeliverySeed } from './support/seed.js';
import { createTestApp, type Actor, type TestApp } from './support/test-app.js';

describe('replaying an endpoint over a time range', () => {
  let t: TestApp;
  let seed: DeliverySeed;
  let manager: Actor;
  let staff: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    seed = await seedOrganization(t.db);
    manager = await t.actor(seed.organizationId, 'MANAGER');
    staff = await t.actor(seed.organizationId, 'STAFF');
  });
  afterAll(() => t.close());

  const urlOf = (s: DeliverySeed) =>
    '/api/v1/applications/' + s.applicationId + '/endpoints/' + s.endpointId + '/replay';
  const row = async (id: string) =>
    (await t.db.query('select status, cycle_base from deliveries where id = $1', [id])).rows[0];

  it('replays failed deliveries in bounded batches and is idempotent', async () => {
    const target = await seedEndpoint(t.db, seed);
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const id = await seedDelivery(t.db, target, { status: 'failed', attemptCount: 4 });
      await t.db.query(
        `update messages set created_at = $2 where id = (select message_id from deliveries where id = $1)`,
        [id, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()],
      );
      ids.push(id);
    }
    const range = { from: '2026-01-03T00:00:00Z', to: '2026-01-11T00:00:00Z' }; // eight messages
    const call = (body: object) => t.http().post(urlOf(target)).set(manager.auth).send(body);

    expect((await call({ ...range, limit: 5 }).expect(200)).body).toEqual({
      replayed: 5,
      more: true,
    });
    expect((await call({ ...range, limit: 5 }).expect(200)).body).toEqual({
      replayed: 3,
      more: false,
    });
    expect((await call(range).expect(200)).body).toEqual({ replayed: 0, more: false });

    const states = await Promise.all(ids.map(row));
    expect(states.filter((s) => s.status === 'pending')).toHaveLength(8);
    expect(states.filter((s) => s.status === 'failed')).toHaveLength(4);
    expect(states.filter((s) => s.status === 'pending').every((s) => s.cycle_base === 4)).toBe(
      true,
    );
    const events = await t.db.query(
      `select count(*)::int as n from outbox_events where type = 'delivery.replayed' and payload->>'endpointId' = $1`,
      [target.endpointId],
    );
    expect(events.rows[0].n).toBe(2);
  });

  it('leaves succeeded and waiting deliveries alone', async () => {
    const target = await seedEndpoint(t.db, seed);
    const ok = await seedDelivery(t.db, target, { status: 'succeeded' });
    const waiting = await seedDelivery(t.db, target, { status: 'pending' });
    const failed = await seedDelivery(t.db, target, { status: 'failed', attemptCount: 2 });
    const body = { from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' };
    expect(
      (await t.http().post(urlOf(target)).set(manager.auth).send(body).expect(200)).body.replayed,
    ).toBe(1);
    expect((await row(ok)).status).toBe('succeeded');
    expect((await row(waiting)).cycle_base).toBe(0);
    expect((await row(failed)).status).toBe('pending');
  });

  it('validates the range and the batch size and needs the replay permission', async () => {
    const url = urlOf(seed);
    const send = (auth: Actor['auth'], body: object) => t.http().post(url).set(auth).send(body);
    await send(manager.auth, { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }).expect(
      400,
    );
    await send(manager.auth, { from: 'x', to: 'y' }).expect(400);
    await send(manager.auth, {
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      limit: 999999,
    }).expect(400);
    await send(staff.auth, { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }).expect(
      403,
    );
    await t.http().post(url).send({}).expect(401);
  });

  it('answers 404 for unknown, archived or other-tenant endpoints and 409 for disabled ones', async () => {
    const range = { from: '2020-01-01T00:00:00Z', to: '2030-01-01T00:00:00Z' };
    const unknown = { ...seed, endpointId: randomUUID() };
    await t.http().post(urlOf(unknown)).set(manager.auth).send(range).expect(404);
    const stranger = await t.actor(randomUUID(), 'OWNER');
    await t.http().post(urlOf(seed)).set(stranger.auth).send(range).expect(404);
    const archived = await seedEndpoint(t.db, seed);
    await t.db.query('update endpoints set archived_at = now() where id = $1', [
      archived.endpointId,
    ]);
    await t.http().post(urlOf(archived)).set(manager.auth).send(range).expect(404);
    const disabled = await seedEndpoint(t.db, seed);
    await t.db.query('update endpoints set enabled = false where id = $1', [disabled.endpointId]);
    await t.http().post(urlOf(disabled)).set(manager.auth).send(range).expect(409);
  });
});
