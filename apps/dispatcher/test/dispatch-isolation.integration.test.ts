import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedDelivery } from './support/seed.js';
import { startServer, type TestServer } from './support/test-server.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

describe('tenant isolation in the dispatcher', () => {
  let t: TestDispatcher;
  let receiver: TestServer;
  const role = new pg.Pool({ connectionString: inject('dispatcherDatabaseUrl'), max: 2 });

  beforeAll(async () => {
    t = await createTestDispatcher({ DISPATCH_BATCH_SIZE: '6', DISPATCH_PER_TENANT_BATCH: '2' });
    receiver = await startServer((_request, response) => response.writeHead(200).end());
  });
  afterAll(async () => {
    await role.end();
    await receiver.close();
    await t.close();
  });

  it('serves a small tenant in the same pass as a tenant with a large backlog', async () => {
    await t.db.query(
      `update deliveries set status = 'succeeded' where status in ('pending', 'in_progress')`,
    );
    const url = 'http://hooks.test:' + receiver.port;
    const busy = randomUUID();
    const quiet = randomUUID();
    for (let i = 0; i < 20; i += 1)
      await seedDelivery(t.db, { url, organizationId: busy, payload: { who: 'busy' } });
    for (let i = 0; i < 2; i += 1)
      await seedDelivery(t.db, { url, organizationId: quiet, payload: { who: 'quiet' } });
    const before = receiver.requests.length;
    await t.dispatcher.drainOnce();
    const sent = receiver.requests
      .slice(before)
      .map((r) => (JSON.parse(r.body) as { who: string }).who);
    expect(sent.filter((who) => who === 'quiet')).toHaveLength(2);
    expect(sent.filter((who) => who === 'busy')).toHaveLength(2); // the per-tenant cap
  });

  it('keeps one tenant attempt history invisible to another, even with the same message id', async () => {
    const url = 'http://hooks.test:' + receiver.port;
    const a = await seedDelivery(t.db, { url });
    await t.dispatcher.drainOnce();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      (await t.attempts.listForMessage(a.organizationId, a.messageId)).length,
    ).toBeGreaterThanOrEqual(1);
    const stranger = randomUUID();
    expect(await t.attempts.listForMessage(stranger, a.messageId)).toEqual([]);
    expect(await t.attempts.listForDelivery(stranger, a.messageId, a.endpointId)).toEqual([]);
    expect(await t.attempts.listForEndpoint(stranger, a.endpointId)).toEqual([]);
    expect(
      (await t.attempts.listForEndpoint(a.organizationId, a.endpointId)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('gives the dispatcher role only the access it needs, under Row Level Security', async () => {
    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:1' });
    const other = await seedDelivery(t.db, { url: 'http://hooks.test:1' });

    const bare = await role.query('select count(*)::int as n from deliveries');
    expect(bare.rows[0].n).toBe(0);
    for (const table of ['api_keys', 'applications', 'idempotency_keys', 'outbox_events'])
      await expect(role.query('select 1 from ' + table), table).rejects.toThrow(
        /permission denied/,
      );
    // Only the name of an event type is visible; its schema and description are not.
    await expect(role.query('select schema from event_types')).rejects.toThrow(/permission denied/);
    await expect(role.query('select description from event_types')).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      role.query('insert into deliveries (id) values ($1)', [randomUUID()]),
    ).rejects.toThrow(/permission denied/);

    const client = await role.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.organization_id', $1, true)`, [
        fixture.organizationId,
      ]);
      const visible = await client.query('select organization_id from deliveries');
      expect(visible.rows.every((row) => row.organization_id === fixture.organizationId)).toBe(
        true,
      );
      const touched = await client.query(`update deliveries set status = 'failed' where id = $1`, [
        other.deliveryId,
      ]);
      expect(touched.rowCount).toBe(0);
      await client.query('commit');
    } finally {
      client.release();
    }
    const unchanged = await t.db.query('select status from deliveries where id = $1', [
      other.deliveryId,
    ]);
    expect(unchanged.rows[0].status).toBe('pending');
  });
});
