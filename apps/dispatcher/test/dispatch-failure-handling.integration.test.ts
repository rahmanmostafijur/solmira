import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDelivery, seedDelivery } from './support/seed.js';
import { startServer, type TestServer } from './support/test-server.js';
import { createTestDispatcher, waitFor, type TestDispatcher } from './support/test-app.js';

describe('failure handling', () => {
  let failing: TestServer;
  let ok: TestServer;
  const arrivals: number[] = [];

  beforeAll(async () => {
    failing = await startServer((_request, response) => response.writeHead(500).end());
    ok = await startServer((_request, response) => {
      arrivals.push(Date.now());
      response.writeHead(200).end();
    });
  });
  afterAll(async () => {
    await failing.close();
    await ok.close();
  });

  it('disables an endpoint after a long failure streak and records exactly one event', async () => {
    const t: TestDispatcher = await createTestDispatcher({
      DISPATCH_PER_ENDPOINT: '8',
      CIRCUIT_FAILURE_THRESHOLD: '1000',
      AUTO_DISABLE_AFTER_HOURS: '1',
      RETRY_SCHEDULE_SECONDS: '0,600,600,600',
    });
    try {
      const first = await seedDelivery(t.db, {
        url: 'http://sick.test:' + failing.port + '/secret-token-abc?key=xyz',
        consecutiveFailures: 20,
        failingFor: '2 hours',
      });
      for (let i = 0; i < 5; i += 1) await addDelivery(t.db, first);
      await t.dispatcher.drainOnce(); // six failures at once, all racing to disable it

      const endpoint = (
        await t.db.query(
          'select enabled, disabled_reason, disabled_at from endpoints where id = $1',
          [first.endpointId],
        )
      ).rows[0];
      expect(endpoint).toMatchObject({ enabled: false, disabled_reason: 'auto_failures' });
      const events = await t.db.query(
        `select organization_id, payload::text as payload from outbox_events
          where type = 'endpoint.auto_disabled' and payload->>'endpointId' = $1`,
        [first.endpointId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0].organization_id).toBe(first.organizationId);
      const payload = JSON.parse(events.rows[0].payload);
      expect(payload).toMatchObject({
        applicationId: first.applicationId,
        host: 'sick.test:' + failing.port,
      });
      expect(payload.consecutiveFailures).toBeGreaterThanOrEqual(21);
      expect(events.rows[0].payload).not.toMatch(/secret-token|xyz/);

      // Later deliveries to the disabled endpoint fail fast, without a send and without a second event.
      const before = failing.requests.length;
      await addDelivery(t.db, first);
      await t.dispatcher.drainOnce();
      expect(failing.requests.length).toBe(before);
      const again = await t.db.query(
        `select count(*)::int as n from outbox_events where type = 'endpoint.auto_disabled' and payload->>'endpointId' = $1`,
        [first.endpointId],
      );
      expect(again.rows[0].n).toBe(1);
    } finally {
      await t.close();
    }
  });

  it('does not disable an endpoint whose streak is still short', async () => {
    const t = await createTestDispatcher({
      AUTO_DISABLE_AFTER_HOURS: '120',
      CIRCUIT_FAILURE_THRESHOLD: '1000',
    });
    try {
      const fixture = await seedDelivery(t.db, {
        url: 'http://short.test:' + failing.port,
        failingFor: '1 hour',
        consecutiveFailures: 3,
      });
      await t.dispatcher.drainOnce();
      const endpoint = (
        await t.db.query('select enabled, consecutive_failures from endpoints where id = $1', [
          fixture.endpointId,
        ])
      ).rows[0];
      expect(endpoint).toMatchObject({ enabled: true, consecutive_failures: 4 });
    } finally {
      await t.close();
    }
  });

  it('counts retries from the latest replay cycle instead of giving up', async () => {
    const t = await createTestDispatcher({
      CIRCUIT_FAILURE_THRESHOLD: '1000',
      RETRY_SCHEDULE_SECONDS: '0,600,600,600',
    });
    try {
      const replayed = await seedDelivery(t.db, {
        url: 'http://cycle.test:' + failing.port,
        attemptCount: 8,
        cycleBase: 8,
      });
      const exhausted = await seedDelivery(t.db, {
        url: 'http://cycle.test:' + failing.port,
        attemptCount: 3,
        cycleBase: 0,
      });
      await t.dispatcher.drainOnce();
      const row = async (id: string) =>
        (await t.db.query('select status, attempt_count from deliveries where id = $1', [id]))
          .rows[0];
      expect(await row(replayed.deliveryId)).toMatchObject({ status: 'pending', attempt_count: 9 });
      expect(await row(exhausted.deliveryId)).toMatchObject({ status: 'failed', attempt_count: 4 });
    } finally {
      await t.close();
    }
  });

  it('keeps an endpoint within its rate limit using Redis, deferring instead of failing', async () => {
    const t = await createTestDispatcher({
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
      DISPATCH_AUTOSTART: 'true',
      DISPATCH_POLL_MS: '50',
      DISPATCH_PER_ENDPOINT: '10',
    });
    try {
      const fixture = await seedDelivery(t.db, {
        url: 'http://limited.test:' + ok.port,
        rateLimitPerSecond: 2,
        payload: { rate: randomUUID() },
      });
      const ids = [fixture.deliveryId];
      for (let i = 0; i < 7; i += 1) ids.push(await addDelivery(t.db, fixture));
      arrivals.length = 0;
      const left = await waitFor(
        async () =>
          (
            await t.db.query(
              `select count(*)::int as n from deliveries where id = any($1) and status <> 'succeeded'`,
              [ids],
            )
          ).rows[0].n as number,
        (n) => n === 0,
        20_000,
      );
      expect(left).toBe(0);
      const perSecond = new Map<number, number>();
      for (const at of arrivals)
        perSecond.set(Math.floor(at / 1000), (perSecond.get(Math.floor(at / 1000)) ?? 0) + 1);
      expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(2);
      expect(arrivals).toHaveLength(8);
      const attempts = await t.db.query(
        'select max(attempt_count)::int as n from deliveries where id = any($1)',
        [ids],
      );
      expect(attempts.rows[0].n).toBe(1); // deferrals are not attempts
    } finally {
      await t.close();
    }
  }, 40_000);
});
