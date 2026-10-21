import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDelivery, seedDelivery } from './support/seed.js';
import { startServer, type TestServer } from './support/test-server.js';
import { createTestDispatcher, waitFor, type TestDispatcher } from './support/test-app.js';

describe('endpoint isolation with the worker loop running', () => {
  let t: TestDispatcher;
  let stalled: TestServer;
  let healthy: TestServer;

  beforeAll(async () => {
    t = await createTestDispatcher({
      DISPATCH_AUTOSTART: 'true',
      DISPATCH_POLL_MS: '50',
      DISPATCH_CONCURRENCY: '10',
      DISPATCH_PER_ENDPOINT: '2',
      DISPATCH_PER_TENANT_BATCH: '10',
      DELIVERY_TIMEOUT_MS: '1500',
      DISPATCH_LEASE_SECONDS: '10',
      CIRCUIT_FAILURE_THRESHOLD: '1000',
      RETRY_SCHEDULE_SECONDS: '0,600,600,600',
    });
    stalled = await startServer(() => undefined); // accepts the request and never answers
    healthy = await startServer((_request, response) => response.writeHead(200).end('ok'));
  });
  afterAll(async () => {
    await t.close();
    await stalled.close();
    await healthy.close();
  });

  const pending = async (ids: string[]) =>
    (
      await t.db.query(
        `select count(*)::int as n from deliveries where id = any($1) and status <> 'succeeded'`,
        [ids],
      )
    ).rows[0].n as number;

  it('delivers to healthy endpoints promptly while a dead one has a large backlog', async () => {
    const organizationId = randomUUID();
    const dead = await seedDelivery(t.db, {
      organizationId,
      url: 'http://dead.test:' + stalled.port,
      dueIn: '-1 hour',
    });
    for (let i = 0; i < 40; i += 1) await addDelivery(t.db, dead, { dueIn: '-1 hour' });

    const healthyIds: string[] = [];
    for (let e = 0; e < 4; e += 1) {
      const fixture = await seedDelivery(t.db, {
        organizationId,
        url: 'http://ok.test:' + healthy.port,
      });
      healthyIds.push(fixture.deliveryId);
      for (let i = 0; i < 9; i += 1) healthyIds.push(await addDelivery(t.db, fixture));
    }
    const other = await seedDelivery(t.db, { url: 'http://ok.test:' + healthy.port });

    const started = Date.now();
    const left = await waitFor(
      () => pending([...healthyIds, other.deliveryId]),
      (n) => n === 0,
      8_000,
    );
    const elapsed = Date.now() - started;
    expect(left).toBe(0);
    expect(elapsed).toBeLessThan(4_000);

    // The dead endpoint never held more than its cap of two at a time.
    const stuck = await t.db.query(
      `select count(*)::int as n from deliveries where endpoint_id = $1 and status = 'in_progress'`,
      [dead.endpointId],
    );
    expect(stuck.rows[0].n).toBeLessThanOrEqual(2);
  }, 20_000);

  it('opens the circuit after repeated failures, sends one probe after the cool-down, and recovers', async () => {
    let status = 500;
    const flaky = await startServer((_request, response) => response.writeHead(status).end());
    const tripper = await createTestDispatcher({
      DISPATCH_AUTOSTART: 'true',
      DISPATCH_POLL_MS: '50',
      DISPATCH_PER_ENDPOINT: '1',
      CIRCUIT_FAILURE_THRESHOLD: '3',
      CIRCUIT_COOLDOWN_BASE_SECONDS: '2',
      RETRY_SCHEDULE_SECONDS: '0,600,600,600',
    });
    try {
      const first = await seedDelivery(tripper.db, { url: 'http://flaky.test:' + flaky.port });
      const ids = [first.deliveryId];
      for (let i = 0; i < 9; i += 1) ids.push(await addDelivery(tripper.db, first));

      await waitFor(
        async () => flaky.requests.length,
        (n) => n >= 3,
        8_000,
      );
      const opened = await waitFor(
        async () =>
          (
            await tripper.db.query(
              'select circuit_open_until, circuit_trips from endpoints where id = $1',
              [first.endpointId],
            )
          ).rows[0],
        (row) => row.circuit_trips >= 1,
      );
      expect(opened.circuit_open_until.getTime()).toBeGreaterThan(Date.now() - 500);

      const atTrip = flaky.requests.length;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(flaky.requests.length).toBe(atTrip); // nothing is sent while the circuit is open

      status = 200; // the receiver recovers; the next probe succeeds and the rest follows
      const remaining = await waitFor(
        () =>
          tripper.db
            .query(
              `select count(*)::int as n from deliveries where id = any($1) and status = 'pending' and attempt_count = 0`,
              [ids],
            )
            .then((r) => r.rows[0].n as number),
        (n) => n === 0,
        15_000,
      );
      expect(remaining).toBe(0);
      const health = (
        await tripper.db.query(
          'select circuit_trips, consecutive_failures, circuit_open_until from endpoints where id = $1',
          [first.endpointId],
        )
      ).rows[0];
      expect(health).toMatchObject({
        circuit_trips: 0,
        consecutive_failures: 0,
        circuit_open_until: null,
      });
    } finally {
      await tripper.close();
      await flaky.close();
    }
  }, 40_000);
});
