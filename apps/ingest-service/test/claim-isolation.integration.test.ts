import pg from 'pg';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { seedDelivery, seedEndpoint, seedOrganization } from './support/seed.js';

interface Claimed {
  delivery_id: string;
  endpoint_id: string;
  organization_id: string;
  attempt: number;
  cycle_base: number;
}

const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 4 });
afterAll(() => owner.end());

const claim = async (limit: number, perTenant: number, perEndpoint: number, lease = 60) =>
  (
    await owner.query<Claimed>('select * from claim_due_deliveries($1, $2, $3, $4)', [
      limit,
      perTenant,
      perEndpoint,
      lease,
    ])
  ).rows;

beforeEach(async () => {
  await owner.query(`update deliveries set status = 'succeeded', completed_at = now()`);
});

describe('claim_due_deliveries isolation (ADR-0033)', () => {
  it('lets a stalled endpoint hold only its own cap, so healthy neighbours are still served', async () => {
    const base = await seedOrganization(owner);
    const stalled = base;
    const healthy = await seedEndpoint(owner, base);
    for (let i = 0; i < 100; i += 1) await seedDelivery(owner, stalled, { dueIn: '-2 hours' });
    for (let i = 0; i < 5; i += 1) await seedDelivery(owner, healthy);

    const first = await claim(50, 50, 3);
    const byEndpoint = (rows: Claimed[], id: string) =>
      rows.filter((r) => r.endpoint_id === id).length;
    expect(byEndpoint(first, stalled.endpointId)).toBe(3);
    expect(byEndpoint(first, healthy.endpointId)).toBe(3);

    // The stalled endpoint still holds its three claims; the next call may not give it more.
    const second = await claim(50, 50, 3);
    expect(byEndpoint(second, stalled.endpointId)).toBe(0);
    expect(byEndpoint(second, healthy.endpointId)).toBe(0); // healthy holds three too
    await owner.query(
      `update deliveries set status = 'succeeded' where endpoint_id = $1 and status = 'in_progress'`,
      [healthy.endpointId],
    );
    const third = await claim(50, 50, 3);
    expect(byEndpoint(third, healthy.endpointId)).toBe(2);
    expect(byEndpoint(third, stalled.endpointId)).toBe(0);
  });

  it('does not offer an endpoint whose circuit is open, and offers it again after the cool-down', async () => {
    const seed = await seedOrganization(owner);
    await seedDelivery(owner, seed);
    await owner.query(
      `update endpoints set circuit_open_until = now() + interval '1 hour', circuit_trips = 1 where id = $1`,
      [seed.endpointId],
    );
    expect(await claim(10, 10, 5)).toEqual([]);
    await owner.query(
      `update endpoints set circuit_open_until = now() - interval '1 second' where id = $1`,
      [seed.endpointId],
    );
    expect(await claim(10, 10, 5)).toHaveLength(1);
  });

  it('lets a tripped endpoint carry one probe at a time once its cool-down is over', async () => {
    const seed = await seedOrganization(owner);
    for (let i = 0; i < 6; i += 1) await seedDelivery(owner, seed);
    await owner.query(
      `update endpoints set circuit_open_until = now() - interval '1 second', circuit_trips = 2 where id = $1`,
      [seed.endpointId],
    );
    expect(await claim(10, 10, 5)).toHaveLength(1);
    expect(await claim(10, 10, 5)).toHaveLength(0); // the probe is still running
    await owner.query(`update endpoints set circuit_trips = 0 where id = $1`, [seed.endpointId]);
    await owner.query(`update deliveries set status = 'succeeded' where status = 'in_progress'`);
    expect(await claim(10, 10, 5)).toHaveLength(5); // closed again: the full cap
  });

  it('reports the cycle a delivery is in, so retries count from the latest replay', async () => {
    const seed = await seedOrganization(owner);
    const id = await seedDelivery(owner, seed, { attemptCount: 9 });
    await owner.query('update deliveries set cycle_base = 8 where id = $1', [id]);
    const [row] = await claim(5, 5, 5);
    expect(row).toMatchObject({ delivery_id: id, attempt: 10, cycle_base: 8 });
  });

  it('never gives one delivery to two workers even with endpoint caps in play', async () => {
    const seed = await seedOrganization(owner);
    for (let i = 0; i < 40; i += 1) await seedDelivery(owner, seed);
    const batches = await Promise.all(Array.from({ length: 4 }, () => claim(40, 40, 40)));
    const ids = batches.flat().map((r) => r.delivery_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(40);
  });
});
