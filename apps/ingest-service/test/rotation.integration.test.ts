import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, createEndpoint } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('signing secret rotation', () => {
  let t: TestApp;
  let admin: Actor;
  let manager: Actor;
  let appId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const org = newOrganizationId();
    admin = await t.actor(org, 'ADMIN');
    manager = await t.actor(org, 'MANAGER');
    appId = (await createApplication(t, admin)).id;
  });
  afterAll(() => t.close());

  const path = (endpointId: string, action: string) =>
    '/api/v1/applications/' + appId + '/endpoints/' + endpointId + '/secret/' + action;
  const secrets = async (endpointId: string) =>
    (
      await t.db.query(
        'select status, expires_at from endpoint_secrets where endpoint_id = $1 order by created_at',
        [endpointId],
      )
    ).rows as { status: string; expires_at: Date | null }[];

  it('makes the old secret the previous one for the window and activates a new secret', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    const rotated = await t
      .http()
      .post(path(endpoint.id, 'rotate'))
      .set(admin.auth)
      .send({ windowHours: 6 })
      .expect(200);
    expect(rotated.body.secret).toMatch(/^whsec_/);
    expect(rotated.body.secret).not.toBe(endpoint.signingSecret);
    const until = Date.parse(rotated.body.previousValidUntil);
    expect(Math.abs(until - (Date.now() + 6 * 3_600_000))).toBeLessThan(10_000);

    const revealed = await t.http().post(path(endpoint.id, 'reveal')).set(admin.auth).expect(200);
    expect(revealed.body.secret).toBe(rotated.body.secret);
    const rows = await secrets(endpoint.id);
    expect(rows.map((r) => r.status)).toEqual(['previous', 'active']);
    expect(rows[0]?.expires_at?.getTime()).toBe(until);
  });

  it('keeps at most one previous secret valid when rotated again inside the window', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    await t.http().post(path(endpoint.id, 'rotate')).set(admin.auth).send({}).expect(200);
    await t.http().post(path(endpoint.id, 'rotate')).set(admin.auth).send({}).expect(200);
    const rows = await secrets(endpoint.id);
    expect(rows.map((r) => r.status)).toEqual(['previous', 'previous', 'active']);
    expect(rows[0]!.expires_at!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(rows[1]!.expires_at!.getTime()).toBeGreaterThan(Date.now() + 20 * 3_600_000);
    const valid = await t.db.query(
      `select count(*)::int as n from endpoint_secrets where endpoint_id = $1 and (status = 'active' or expires_at > now())`,
      [endpoint.id],
    );
    expect(valid.rows[0].n).toBe(2);
  });

  it('audits the rotation without any secret and keeps the secret encrypted', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    const rotated = await t
      .http()
      .post(path(endpoint.id, 'rotate'))
      .set(admin.auth)
      .send({})
      .expect(200);
    const events = await t.db.query(
      `select actor_id, payload::text as payload from outbox_events
        where type = 'endpoint_secret.rotated' and payload->>'endpointId' = $1`,
      [endpoint.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].actor_id).toBe(admin.userId);
    expect(events.rows[0].payload).not.toContain(rotated.body.secret);
    expect(events.rows[0].payload).not.toContain(endpoint.signingSecret);
    const stored = await t.db.query(
      'select ciphertext from endpoint_secrets where endpoint_id = $1',
      [endpoint.id],
    );
    for (const secret of [rotated.body.secret, endpoint.signingSecret])
      for (const row of stored.rows)
        expect(row.ciphertext.includes(Buffer.from(secret))).toBe(false);
  });

  it('needs the rotate permission, a live endpoint and a sane window', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    await t.http().post(path(endpoint.id, 'rotate')).set(manager.auth).send({}).expect(403);
    await t.http().post(path(endpoint.id, 'rotate')).send({}).expect(401);
    await t
      .http()
      .post(path(endpoint.id, 'rotate'))
      .set(admin.auth)
      .send({ windowHours: 0 })
      .expect(400);
    await t
      .http()
      .post(path(endpoint.id, 'rotate'))
      .set(admin.auth)
      .send({ windowHours: 9999 })
      .expect(400);
    await t
      .http()
      .delete('/api/v1/applications/' + appId + '/endpoints/' + endpoint.id)
      .set(admin.auth)
      .expect(204);
    await t.http().post(path(endpoint.id, 'rotate')).set(admin.auth).send({}).expect(404);
  });

  it('cannot rotate the secret of another organization', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    const stranger = await t.actor(newOrganizationId(), 'OWNER');
    await t.http().post(path(endpoint.id, 'rotate')).set(stranger.auth).send({}).expect(404);
    expect((await secrets(endpoint.id)).map((r) => r.status)).toEqual(['active']);
  });

  it('gives a re-enabled endpoint a fresh start', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    const url = '/api/v1/applications/' + appId + '/endpoints/' + endpoint.id;
    await t.db.query(
      `update endpoints set enabled = false, disabled_reason = 'auto_failures', consecutive_failures = 30,
              first_failure_at = now() - interval '6 days', circuit_trips = 4, circuit_open_until = now() + interval '1 hour'
        where id = $1`,
      [endpoint.id],
    );
    await t.http().patch(url).set(manager.auth).send({ enabled: true }).expect(200);
    const row = (await t.db.query('select * from endpoints where id = $1', [endpoint.id])).rows[0];
    expect(row).toMatchObject({
      enabled: true,
      disabled_reason: null,
      consecutive_failures: 0,
      first_failure_at: null,
      circuit_trips: 0,
      circuit_open_until: null,
    });
  });
});
