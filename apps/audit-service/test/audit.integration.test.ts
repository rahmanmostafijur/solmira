import { randomUUID } from 'node:crypto';
import { AUDITED_EVENT_TYPES } from '@solmira/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { sampleEvents } from './support/samples.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

const until = async (check: () => Promise<boolean>, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(await check())) await new Promise((r) => setTimeout(r, 50));
};

describe('audit trail', () => {
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

  it('records every audited action, with actor, target and time, and nothing else', async () => {
    const org = newOrganizationId();
    const manager = await t.actor(org, 'MANAGER');
    const { payloads } = sampleEvents();
    const actor = randomUUID();

    for (const [type, payload] of Object.entries(payloads))
      await t.publish(type, org, payload, randomUUID(), actor);
    // Events that are not administrative actions are published too and must leave no trace.
    await t.publish('message.created', org, {
      messageId: randomUUID(),
      applicationId: randomUUID(),
    });
    await t.publish('delivery.attempted', org, { deliveryId: randomUUID() });
    await until(async () => (await countOf(org)) >= AUDITED_EVENT_TYPES.length);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const body = await recordsOf(manager, '?pageSize=100');
    expect(body.total).toBe(AUDITED_EVENT_TYPES.length);
    expect(body.items.map((r: { action: string }) => r.action).sort()).toEqual(
      [...AUDITED_EVENT_TYPES].sort(),
    );
    for (const record of body.items) {
      expect(record).toMatchObject({ actorType: 'user', actorId: actor });
      expect(new Date(record.occurredAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(record.targetId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('records an event once, however often it is delivered', async () => {
    const org = newOrganizationId();
    const { payloads } = sampleEvents();
    const eventId = randomUUID();
    await t.publish('application.created', org, payloads['application.created']!, eventId);
    await t.publish('application.created', org, payloads['application.created']!, eventId);
    await until(async () => (await countOf(org)) >= 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await countOf(org)).toBe(1);
  });

  it('attributes actions of the platform to the system', async () => {
    const org = newOrganizationId();
    const manager = await t.actor(org, 'MANAGER');
    const { payloads } = sampleEvents();
    await t.publish(
      'endpoint.auto_disabled',
      org,
      payloads['endpoint.auto_disabled']!,
      randomUUID(),
      null,
    );
    await until(async () => (await countOf(org)) >= 1);

    const [record] = (await recordsOf(manager)).items;
    expect(record).toMatchObject({
      actorType: 'system',
      actorId: null,
      action: 'endpoint.auto_disabled',
    });
  });

  it('keeps a malformed audited event out of the trail instead of recording a guess', async () => {
    const org = newOrganizationId();
    await t.publish('application.created', org, { name: 'no target' });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await countOf(org)).toBe(0);
  });

  it('filters by action, actor, target and time, newest first, with paging', async () => {
    const org = newOrganizationId();
    const manager = await t.actor(org, 'MANAGER');
    const { payloads, ids } = sampleEvents();
    const alice = randomUUID();
    const bob = randomUUID();
    await t.publish(
      'application.created',
      org,
      payloads['application.created']!,
      randomUUID(),
      alice,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await t.publish('endpoint.updated', org, payloads['endpoint.updated']!, randomUUID(), bob);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await t.publish('endpoint.archived', org, payloads['endpoint.archived']!, randomUUID(), alice);
    await until(async () => (await countOf(org)) >= 3);

    const all = await recordsOf(manager);
    expect(all.items.map((r: { action: string }) => r.action)).toEqual([
      'endpoint.archived',
      'endpoint.updated',
      'application.created',
    ]);
    expect((await recordsOf(manager, '?action=endpoint.updated')).total).toBe(1);
    expect((await recordsOf(manager, `?actorId=${alice}`)).total).toBe(2);
    expect((await recordsOf(manager, `?targetType=endpoint&targetId=${ids.endpoint}`)).total).toBe(
      2,
    );
    expect((await recordsOf(manager, '?from=2999-01-01T00:00:00.000Z')).total).toBe(0);
    const page = await recordsOf(manager, '?pageSize=2&page=2');
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);
  });
});
