import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HOUR,
  T0,
  attemptPayload,
  countAttempts,
  percentile,
  publishAttempts,
  type AttemptSpec,
} from './support/fixtures.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Figures are checked against fixtures whose answers are known in advance. The range is fixed,
 * so the tests do not depend on the clock.
 */
const RANGE = `from=${T0.toISOString()}&to=${new Date(T0.getTime() + 24 * HOUR).toISOString()}`;

describe('delivery analytics', () => {
  let t: TestApp;
  let org: string;
  let viewer: Actor;
  const app = randomUUID();
  const fast = randomUUID();
  const flaky = randomUUID();
  const durationsFast = Array.from({ length: 100 }, (_, i) => i + 1);
  const durationsFlaky = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

  beforeAll(async () => {
    t = await createTestApp();
    org = newOrganizationId();
    viewer = await t.actor(org, 'VIEWER');
    // `fast`: 100 deliveries with one attempt each, 1..100 ms; the last ten failed.
    const fastSpecs: AttemptSpec[] = durationsFast.map((durationMs) => ({
      endpointId: fast,
      applicationId: app,
      durationMs,
      result: durationMs > 90 ? 'failed' : 'succeeded',
    }));
    // `flaky`: 5 deliveries, each failing once and then succeeding; 100..1000 ms.
    const flakySpecs: AttemptSpec[] = durationsFlaky.map((durationMs, i) => ({
      endpointId: flaky,
      applicationId: app,
      deliveryId: 'aaaaaaaa-0000-4000-8000-00000000000' + Math.floor(i / 2),
      attempt: (i % 2) + 1,
      durationMs,
      result: i % 2 === 0 ? 'retrying' : 'succeeded',
    }));
    await publishAttempts(t, org, [...fastSpecs, ...flakySpecs]);
  });
  afterAll(() => t.close());

  const report = async (path: string, actor = viewer) =>
    (await t.http().get(`/api/v1/analytics/${path}?${RANGE}`).set(actor.auth).expect(200)).body;

  it('reports success rate, attempts per delivery and percentiles per endpoint', async () => {
    const body = await report(`applications/${app}`);
    const byEndpoint = Object.fromEntries(
      body.endpoints.map((e: { endpointId: string }) => [e.endpointId, e]),
    );

    expect(byEndpoint[fast]).toMatchObject({
      attempts: 100,
      successfulAttempts: 90,
      successRate: 0.9,
      deliveries: 100,
      attemptsPerDelivery: 1,
    });
    // 1..100: the position of p is 1 + 99p, interpolated between neighbours.
    expect(byEndpoint[fast].latencyMs.p50).toBeCloseTo(50.5, 2);
    expect(byEndpoint[fast].latencyMs.p95).toBeCloseTo(95.05, 2);
    expect(byEndpoint[fast].latencyMs.p99).toBeCloseTo(99.01, 2);

    expect(byEndpoint[flaky]).toMatchObject({
      attempts: 10,
      successfulAttempts: 5,
      successRate: 0.5,
      deliveries: 5,
      attemptsPerDelivery: 2,
    });
    expect(byEndpoint[flaky].latencyMs.p50).toBeCloseTo(550, 2);
    expect(byEndpoint[flaky].latencyMs.p95).toBeCloseTo(955, 2);
    expect(byEndpoint[flaky].latencyMs.p99).toBeCloseTo(991, 2);
  });

  it('reports the application as a whole, matching an independent calculation', async () => {
    const body = await report(`applications/${app}`);
    const all = [...durationsFast, ...durationsFlaky];

    expect(body.summary).toMatchObject({
      attempts: 110,
      successfulAttempts: 95,
      deliveries: 105,
    });
    expect(body.summary.successRate).toBeCloseTo(95 / 110, 4);
    expect(body.summary.attemptsPerDelivery).toBeCloseTo(110 / 105, 2);
    expect(body.summary.latencyMs.p50).toBeCloseTo(percentile(all, 0.5), 2);
    expect(body.summary.latencyMs.p95).toBeCloseTo(percentile(all, 0.95), 2);
    expect(body.summary.latencyMs.p99).toBeCloseTo(percentile(all, 0.99), 2);
  });

  it('lists every application of the organization', async () => {
    const body = await report('applications');
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0]).toMatchObject({ applicationId: app, attempts: 110 });
  });

  it('counts only attempts inside the range, with the end exclusive', async () => {
    const other = newOrganizationId();
    const actor = await t.actor(other, 'ADMIN');
    const application = randomUUID();
    const endpoint = randomUUID();
    const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);
    await publishAttempts(t, other, [
      { applicationId: application, endpointId: endpoint, durationMs: 10, startedAt: at(-1) },
      { applicationId: application, endpointId: endpoint, durationMs: 20, startedAt: at(0) },
      { applicationId: application, endpointId: endpoint, durationMs: 30, startedAt: at(23) },
      { applicationId: application, endpointId: endpoint, durationMs: 40, startedAt: at(24) },
    ]);

    const body = await report(`applications/${application}`, actor);
    expect(body.summary.attempts).toBe(2);
    expect(body.summary.latencyMs.p50).toBeCloseTo(25, 2);
  });

  it('answers with nulls, not zeros, when there is nothing to report', async () => {
    const body = await report(`applications/${randomUUID()}`);
    expect(body.endpoints).toEqual([]);
    expect(body.summary).toEqual({
      attempts: 0,
      successfulAttempts: 0,
      successRate: null,
      deliveries: 0,
      attemptsPerDelivery: null,
      latencyMs: { p50: null, p95: null, p99: null },
    });
  });

  it('stores an event once, however often it is delivered', async () => {
    const other = newOrganizationId();
    const payload = attemptPayload({
      applicationId: randomUUID(),
      endpointId: randomUUID(),
      durationMs: 5,
    });
    const eventId = randomUUID();
    await t.publish('delivery.attempted', other, payload, eventId);
    await t.publish('delivery.attempted', other, payload, eventId);
    await t.publish('delivery.attempted', other, payload, randomUUID());
    await publishAttempts(t, other, []);
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    // The repeat of the event and a second event for the same attempt are one fact.
    expect(await countAttempts(t, other)).toBe(1);
  });

  it('refuses a malformed event and stores nothing for it', async () => {
    const other = newOrganizationId();
    await t.publish('delivery.attempted', other, { deliveryId: 'not-a-uuid' });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await countAttempts(t, other)).toBe(0);
  });

  it('never shows one organization the attempts of another', async () => {
    const intruder = await t.actor(newOrganizationId(), 'OWNER');

    const foreign = await report(`applications/${app}`, intruder);
    expect(foreign.summary.attempts).toBe(0);
    expect(foreign.endpoints).toEqual([]);
    const listed = await report('applications', intruder);
    expect(
      listed.applications.map((a: { applicationId: string }) => a.applicationId),
    ).not.toContain(app);
  });

  it('requires authentication, an organization and the analytics.read permission', async () => {
    await t.http().get(`/api/v1/analytics/applications?${RANGE}`).expect(401);
    const noPermission = await t.actor(org, 'VIEWER', ['messages.read']);
    await t
      .http()
      .get(`/api/v1/analytics/applications?${RANGE}`)
      .set(noPermission.auth)
      .expect(403);
  });

  it('rejects an invalid range', async () => {
    const reversed = `from=${new Date(T0.getTime() + HOUR).toISOString()}&to=${T0.toISOString()}`;
    await t.http().get(`/api/v1/analytics/applications?${reversed}`).set(viewer.auth).expect(400);
    const tooLong = `from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z`;
    await t.http().get(`/api/v1/analytics/applications?${tooLong}`).set(viewer.auth).expect(400);
  });

  it('removes attempts older than the retention period and keeps newer ones', async () => {
    const other = newOrganizationId();
    const day = 24 * HOUR;
    await publishAttempts(t, other, [
      {
        applicationId: randomUUID(),
        endpointId: randomUUID(),
        durationMs: 1,
        startedAt: new Date(Date.now() - 400 * day),
      },
      {
        applicationId: randomUUID(),
        endpointId: randomUUID(),
        durationMs: 2,
        startedAt: new Date(Date.now() - day),
      },
    ]);

    expect(await t.maintenance.runOnce()).toBeGreaterThanOrEqual(1);
    expect(await countAttempts(t, other)).toBe(1);
  });
});
