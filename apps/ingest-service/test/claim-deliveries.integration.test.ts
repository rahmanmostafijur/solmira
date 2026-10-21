import pg from 'pg';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { seedDelivery, seedOrganization } from './support/seed.js';

interface Claimed {
  delivery_id: string;
  organization_id: string;
  attempt: number;
}

const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 4 });
afterAll(() => owner.end());

const claim = async (
  limit: number,
  perTenant: number,
  leaseSeconds = 60,
  perEndpoint = 1000,
  db: pg.Pool = owner,
) =>
  (
    await db.query<Claimed>('select * from claim_due_deliveries($1, $2, $3, $4)', [
      limit,
      perTenant,
      perEndpoint,
      leaseSeconds,
    ])
  ).rows;

// Each test starts from an empty queue so counts are exact.
beforeEach(async () => {
  await owner.query('update deliveries set status = $1, completed_at = now()', ['succeeded']);
});

describe('claim_due_deliveries', () => {
  it('takes only deliveries that are due and marks them in progress with a lease', async () => {
    const seed = await seedOrganization(owner);
    const due = await seedDelivery(owner, seed, { dueIn: '-1 minute' });
    const later = await seedDelivery(owner, seed, { dueIn: '1 hour' });
    const held = await seedDelivery(owner, seed, { status: 'in_progress', lockedFor: '1 hour' });
    const done = await seedDelivery(owner, seed, { status: 'succeeded' });

    const claimed = await claim(10, 10, 30);
    expect(claimed.map((row) => row.delivery_id)).toEqual([due]);

    const { rows } = await owner.query(
      `select id, status, locked_until > now() as leased from deliveries where id = any($1)`,
      [[due, later, held, done]],
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[due]).toMatchObject({ status: 'in_progress', leased: true });
    expect(byId[later].status).toBe('pending');
    expect(byId[held].status).toBe('in_progress');
    expect(byId[done].status).toBe('succeeded');
  });

  it('numbers the attempt after the recorded ones and does not advance the count itself', async () => {
    const seed = await seedOrganization(owner);
    const fresh = await seedDelivery(owner, seed);
    const retry = await seedDelivery(owner, seed, { attemptCount: 3 });
    const claimed = await claim(10, 10);
    const attempts = Object.fromEntries(claimed.map((row) => [row.delivery_id, row.attempt]));
    expect(attempts[fresh]).toBe(1);
    expect(attempts[retry]).toBe(4);
    const { rows } = await owner.query(
      'select id, attempt_count from deliveries where id = any($1)',
      [[fresh, retry]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.attempt_count]))).toEqual({
      [fresh]: 0,
      [retry]: 3,
    });
  });

  it('hands a delivery to another worker once its lease has expired, with the same attempt number', async () => {
    const seed = await seedOrganization(owner);
    const id = await seedDelivery(owner, seed, { attemptCount: 1 });
    const first = await claim(10, 10, 1);
    expect(first.map((row) => [row.delivery_id, row.attempt])).toEqual([[id, 2]]);
    expect(await claim(10, 10, 1)).toEqual([]); // still leased

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const again = await claim(10, 10, 60);
    expect(again.map((row) => [row.delivery_id, row.attempt])).toEqual([[id, 2]]);
  });

  it('limits what one organization can take, so a backlog cannot fill the batch', async () => {
    const busy = await seedOrganization(owner);
    const quiet = await seedOrganization(owner);
    const other = await seedOrganization(owner);
    for (let i = 0; i < 30; i += 1) await seedDelivery(owner, busy);
    for (let i = 0; i < 3; i += 1) await seedDelivery(owner, quiet);
    for (let i = 0; i < 2; i += 1) await seedDelivery(owner, other);

    const claimed = await claim(100, 5);
    const perOrganization = new Map<string, number>();
    for (const row of claimed)
      perOrganization.set(row.organization_id, (perOrganization.get(row.organization_id) ?? 0) + 1);
    expect(perOrganization.get(busy.organizationId)).toBe(5);
    expect(perOrganization.get(quiet.organizationId)).toBe(3);
    expect(perOrganization.get(other.organizationId)).toBe(2);
    expect(claimed).toHaveLength(10);
  });

  it('serves the organization that has waited longest first', async () => {
    const waiting = await seedOrganization(owner);
    const recent = await seedOrganization(owner);
    await seedDelivery(owner, recent, { dueIn: '-1 minute' });
    const oldest = await seedDelivery(owner, waiting, { dueIn: '-2 hours' });
    const claimed = await claim(1, 5);
    expect(claimed.map((row) => row.delivery_id)).toEqual([oldest]);
  });

  it('never gives one delivery to two workers claiming at the same time', async () => {
    const seeds = await Promise.all(Array.from({ length: 5 }, () => seedOrganization(owner)));
    for (const seed of seeds) for (let i = 0; i < 10; i += 1) await seedDelivery(owner, seed);

    const batches = await Promise.all(Array.from({ length: 4 }, () => claim(20, 10)));
    const ids = batches.flat().map((row) => row.delivery_id);
    expect(new Set(ids).size).toBe(ids.length);
    // Workers that pick the same candidates skip rows the others hold; a follow-up pass collects them.
    const rest = (await claim(100, 100)).map((row) => row.delivery_id);
    expect(new Set([...ids, ...rest]).size).toBe(50);
    expect(ids.length + rest.length).toBe(50);
  });

  it('is not callable by the public role', async () => {
    const { rows } = await owner.query(
      `select has_function_privilege('public', 'claim_due_deliveries(integer, integer, integer, integer)', 'execute') as callable`,
    );
    expect(rows[0].callable).toBe(false);
  });
});
