import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { sampleEvents } from './support/samples.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

const until = async (check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(await check())) await new Promise((r) => setTimeout(r, 50));
};

/** Isolation between tenants, who may read, and the guarantees the database itself gives. */
describe('audit trail integrity', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const countOf = async (organizationId: string) =>
    (
      await t.db.query('select count(*)::int as n from audit_logs where organization_id = $1', [
        organizationId,
      ])
    ).rows[0].n as number;
  const recordsOf = async (actor: Actor, query = '') =>
    (
      await t
        .http()
        .get('/api/v1/audit-logs' + query)
        .set(actor.auth)
        .expect(200)
    ).body;

  it('never shows one organization the actions of another', async () => {
    const orgA = newOrganizationId();
    const managerA = await t.actor(orgA, 'MANAGER');
    const managerB = await t.actor(newOrganizationId(), 'OWNER');
    const { payloads, ids } = sampleEvents();
    await t.publish('application.created', orgA, payloads['application.created']!);
    await t.publish('endpoint_secret.revealed', orgA, payloads['endpoint_secret.revealed']!);
    await until(async () => (await countOf(orgA)) >= 2);

    expect((await recordsOf(managerA)).total).toBe(2);
    const other = await recordsOf(managerB);
    expect(other.total).toBe(0);
    expect(other.items).toEqual([]);
    // Naming the other tenant's target in a filter does not reach its records either.
    expect((await recordsOf(managerB, `?targetId=${ids.application}`)).total).toBe(0);
  });

  it('hides every record from the runtime role without a tenant, and from other tenants', async () => {
    const org = newOrganizationId();
    await t.publish('application.created', org, sampleEvents().payloads['application.created']!);
    await until(async () => (await countOf(org)) >= 1);
    const runtime = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });
    try {
      expect((await runtime.query('select count(*)::int as n from audit_logs')).rows[0].n).toBe(0);
      const client = await runtime.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.organization_id', $1, true)`, [
          newOrganizationId(),
        ]);
        expect((await client.query('select count(*)::int as n from audit_logs')).rows[0].n).toBe(0);
        await client.query('rollback');
      } finally {
        client.release();
      }
    } finally {
      await runtime.end();
    }
  });

  it('requires authentication and the audit_logs.read permission', async () => {
    await t.http().get('/api/v1/audit-logs').expect(401);
    const viewer = await t.actor(newOrganizationId(), 'VIEWER');
    await t.http().get('/api/v1/audit-logs').set(viewer.auth).expect(403);
    const manager = await t.actor(newOrganizationId(), 'MANAGER');
    await t.http().get('/api/v1/audit-logs').set(manager.auth).expect(200);
  });

  it('is append-only: the runtime role cannot change or remove a record of its own tenant', async () => {
    const org = newOrganizationId();
    await t.publish('application.created', org, sampleEvents().payloads['application.created']!);
    await until(async () => (await countOf(org)) >= 1);
    const runtime = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });
    const asTenant = async (statement: string) => {
      const client = await runtime.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.organization_id', $1, true)`, [org]);
        await client.query(statement);
        await client.query('commit');
      } finally {
        await client.query('rollback').catch(() => undefined);
        client.release();
      }
    };
    const refused = /append-only|permission denied/;
    try {
      await expect(asTenant(`update audit_logs set action = 'tampered'`)).rejects.toThrow(refused);
      await expect(asTenant('delete ' + 'from audit_logs')).rejects.toThrow(refused);
      await expect(asTenant('truncate audit_logs')).rejects.toThrow(refused);
    } finally {
      await runtime.end();
    }
    const stored = await t.db.query(`select action from audit_logs where organization_id = $1`, [
      org,
    ]);
    expect(stored.rows.map((row) => row.action)).toEqual(['application.created']);
  });

  it('removes only records older than the retention period', async () => {
    const org = newOrganizationId();
    const { payloads } = sampleEvents();
    const old = new Date(Date.now() - 500 * 86_400_000).toISOString();
    await t.publish(
      'application.created',
      org,
      payloads['application.created']!,
      randomUUID(),
      null,
      old,
    );
    await t.publish('application.archived', org, payloads['application.archived']!);
    await until(async () => (await countOf(org)) >= 2);

    expect(await t.maintenance.runOnce()).toBeGreaterThanOrEqual(1);
    const left = await t.db.query(`select action from audit_logs where organization_id = $1`, [
      org,
    ]);
    expect(left.rows.map((row) => row.action)).toEqual(['application.archived']);
  });
});
