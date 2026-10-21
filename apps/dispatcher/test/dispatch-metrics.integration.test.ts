import { MetricsRegistry } from '@solmira/service-kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer, type TestServer } from './support/test-server.js';
import { seedDelivery } from './support/seed.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

describe('dispatcher metrics (ADR-0039)', () => {
  let t: TestDispatcher;
  let receiver: TestServer;
  let status = 200;

  beforeAll(async () => {
    t = await createTestDispatcher({ METRICS_ENABLED: 'true' });
    receiver = await startServer((_request, response) => response.writeHead(status).end('x'));
  });
  afterAll(async () => {
    await receiver.close();
    await t.close();
  });

  /** Flushes the registry and returns the metric lines it wrote. */
  async function flushed(): Promise<Record<string, unknown>[]> {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await t.app.get(MetricsRegistry).flush();
    } finally {
      spy.mockRestore();
    }
    return written.flatMap((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('{"_aws"'))
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
  }

  it('counts attempts by result and observes how long they took', async () => {
    await flushed();
    status = 200;
    await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port + '/h' });
    await t.dispatcher.drainOnce();
    status = 500;
    await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port + '/h' });
    await t.dispatcher.drainOnce();

    const lines = await flushed();
    const attempts = Object.fromEntries(
      lines.filter((line) => line.Result).map((line) => [line.Result, line.Attempts]),
    );
    expect(attempts).toEqual({ succeeded: 1, retrying: 1 });
    const duration = lines.find((line) => line.AttemptDuration)!.AttemptDuration as {
      Count: number;
    };
    expect(duration.Count).toBe(2);
  });

  it('reports how much is due and how long the oldest has waited', async () => {
    await flushed();
    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port + '/h' });
    await t.db.query(
      `update deliveries set next_attempt_at = now() - interval '90 seconds' where id = $1`,
      [fixture.deliveryId],
    );

    const lines = await flushed();
    const gauges = lines.find((line) => 'DeliveriesDue' in line)!;
    expect(gauges.DeliveriesDue as number).toBeGreaterThanOrEqual(1);
    expect(gauges.OldestDueAge as number).toBeGreaterThanOrEqual(90);
    expect(gauges.InFlight).toBe(0);
  });

  it('counts a secret that could not be decrypted', async () => {
    await flushed();
    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port + '/h' });
    await t.db.query(`update endpoint_secrets set key_id = 'elsewhere' where endpoint_id = $1`, [
      fixture.endpointId,
    ]);
    await t.dispatcher.drainOnce();

    const lines = await flushed();
    expect(lines.find((line) => 'SecretDecryptFailures' in line)?.SecretDecryptFailures).toBe(1);
    expect(lines.find((line) => line.Reason === 'secret')?.DeliveriesDeferred).toBe(1);
  });
});
