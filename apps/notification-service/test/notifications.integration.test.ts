import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('endpoint alerts', () => {
  let t: TestApp;
  let viewer: Actor;
  let org: string;

  beforeAll(async () => {
    t = await createTestApp();
    org = newOrganizationId();
    viewer = await t.actor(org, 'VIEWER');
  });
  afterAll(() => t.close());

  const disabledEvent = (overrides: object = {}) => ({
    endpointId: randomUUID(),
    applicationId: randomUUID(),
    host: 'hooks.acme.example',
    failingSince: '2026-10-10T08:00:00.000Z',
    consecutiveFailures: 42,
    ...overrides,
  });
  const notificationsOf = async (actor: Actor) =>
    (await t.http().get('/api/v1/notifications').set(actor.auth).expect(200)).body.items as {
      id: string;
      type: string;
      title: string;
      body: string;
      data: { endpointId: string };
      readAt: string | null;
    }[];
  const until = async (check: () => Promise<boolean>) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(await check())) await new Promise((r) => setTimeout(r, 50));
  };

  it('notifies the organization once, however often the event is delivered', async () => {
    const payload = disabledEvent();
    const eventId = randomUUID();
    for (let i = 0; i < 3; i += 1) await t.publish('endpoint.auto_disabled', org, payload, eventId);
    await until(async () => (await notificationsOf(viewer)).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const items = (await notificationsOf(viewer)).filter(
      (n) => n.data.endpointId === payload.endpointId,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'endpoint.auto_disabled', readAt: null });
    expect(items[0]!.body).toContain('hooks.acme.example');
    expect(items[0]!.body).toContain('2026-10-10');
    const claims = await t.db.query(
      'select count(*)::int as n from processed_events where event_id = $1',
      [eventId],
    );
    expect(claims.rows[0].n).toBe(1);
  });

  it('keeps separate events separate and shows each organization only its own', async () => {
    const mine = disabledEvent();
    const theirs = disabledEvent();
    const otherOrg = newOrganizationId();
    const stranger = await t.actor(otherOrg, 'OWNER');
    await t.publish('endpoint.auto_disabled', org, mine);
    await t.publish('endpoint.auto_disabled', otherOrg, theirs);
    await until(async () => (await notificationsOf(stranger)).length >= 1);
    await until(async () =>
      (await notificationsOf(viewer)).some((n) => n.data.endpointId === mine.endpointId),
    );

    expect(
      (await notificationsOf(viewer)).some((n) => n.data.endpointId === theirs.endpointId),
    ).toBe(false);
    expect((await notificationsOf(stranger)).map((n) => n.data.endpointId)).toEqual([
      theirs.endpointId,
    ]);
  });

  it('marks a notification read once and refuses other organizations', async () => {
    const payload = disabledEvent();
    await t.publish('endpoint.auto_disabled', org, payload);
    await until(async () =>
      (await notificationsOf(viewer)).some((n) => n.data.endpointId === payload.endpointId),
    );
    const id = (await notificationsOf(viewer)).find(
      (n) => n.data.endpointId === payload.endpointId,
    )!.id;

    const first = await t
      .http()
      .post('/api/v1/notifications/' + id + '/read')
      .set(viewer.auth)
      .expect(200);
    const second = await t
      .http()
      .post('/api/v1/notifications/' + id + '/read')
      .set(viewer.auth)
      .expect(200);
    expect(first.body.readAt).not.toBeNull();
    expect(second.body.readAt).toBe(first.body.readAt);
    const unread = await t
      .http()
      .get('/api/v1/notifications?unreadOnly=true')
      .set(viewer.auth)
      .expect(200);
    expect(unread.body.items.some((n: { id: string }) => n.id === id)).toBe(false);

    const stranger = await t.actor(newOrganizationId(), 'OWNER');
    await t
      .http()
      .post('/api/v1/notifications/' + id + '/read')
      .set(stranger.auth)
      .expect(404);
    await t.http().get('/api/v1/notifications').expect(401);
  });

  it('marks every unread notification of the organization read, and no other', async () => {
    const team = newOrganizationId();
    const member = await t.actor(team, 'STAFF');
    const stranger = await t.actor(newOrganizationId(), 'OWNER');
    for (let i = 0; i < 3; i += 1) await t.publish('endpoint.auto_disabled', team, disabledEvent());
    await t.publish('endpoint.auto_disabled', stranger.organizationId, disabledEvent());
    await until(async () => (await notificationsOf(member)).length >= 3);
    await until(async () => (await notificationsOf(stranger)).length >= 1);
    const [early] = await notificationsOf(member);
    const readEarly = await t
      .http()
      .post('/api/v1/notifications/' + early!.id + '/read')
      .set(member.auth)
      .expect(200);

    const readAll = () =>
      t.http().post('/api/v1/notifications/read-all').set(member.auth).expect(200);
    expect((await readAll()).body).toEqual({ updated: 2 });
    expect((await readAll()).body).toEqual({ updated: 0 });

    const items = await notificationsOf(member);
    expect(items.every((n) => n.readAt !== null)).toBe(true);
    expect(items.find((n) => n.id === early!.id)!.readAt).toBe(readEarly.body.readAt);
    expect((await notificationsOf(stranger)).map((n) => n.readAt)).toEqual([null]);
  });

  it('requires the permission to acknowledge notifications for read-all', async () => {
    const team = newOrganizationId();
    const token = await t.token({ organizationId: team, permissions: ['analytics.read'] });
    await t
      .http()
      .post('/api/v1/notifications/read-all')
      .set({ Authorization: 'Bearer ' + token })
      .expect(403);
    await t.http().post('/api/v1/notifications/read-all').expect(401);
  });

  it('sends a malformed event to the dead-letter queue instead of notifying', async () => {
    const before = (await notificationsOf(viewer)).length;
    await t.publish('endpoint.auto_disabled', null, disabledEvent());
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect((await notificationsOf(viewer)).length).toBe(before);
  });

  it('hides every row from the runtime role without a tenant', async () => {
    const runtime = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });
    try {
      const { rows } = await runtime.query('select count(*)::int as n from notifications');
      expect(rows[0].n).toBe(0);
    } finally {
      await runtime.end();
    }
  });
});
