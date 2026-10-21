import { describe, expect, it } from 'vitest';
import { addDelivery, seedDelivery } from './support/seed.js';
import { startServer } from './support/test-server.js';
import { createTestDispatcher, waitFor } from './support/test-app.js';

describe('circuit breaker', () => {
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
