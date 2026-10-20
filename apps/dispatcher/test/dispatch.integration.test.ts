import { verifyWebhook } from '@solmira/webhooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './support/test-server.js';
import { seedDelivery } from './support/seed.js';
import { createTestDispatcher, waitFor, type TestDispatcher } from './support/test-app.js';

interface DeliveryRow {
  status: string;
  attempt_count: number;
  next_attempt_at: Date;
  last_status_code: number | null;
  last_error_class: string | null;
  completed_at: Date | null;
}

describe('dispatching deliveries', () => {
  let t: TestDispatcher;
  let receiver: TestServer;
  let respond: (status: number) => number = () => 200;

  beforeAll(async () => {
    t = await createTestDispatcher();
    receiver = await startServer((_request, response) => response.writeHead(respond(0)).end('ok'));
  });
  afterAll(async () => {
    await receiver.close();
    await t.close();
  });

  const urlOf = () => 'http://hooks.test:' + receiver.port + '/webhooks';
  const rowOf = async (deliveryId: string) =>
    (await t.db.query<DeliveryRow>('select * from deliveries where id = $1', [deliveryId]))
      .rows[0]!;

  it('sends a signed request a receiver can verify and records success', async () => {
    respond = () => 200;
    const before = receiver.requests.length;
    const fixture = await seedDelivery(t.db, {
      url: urlOf(),
      headers: { 'x-tenant': 'acme' },
      payload: { id: 'inv_9', amount: 12 },
    });
    expect(await t.dispatcher.drainOnce()).toBeGreaterThanOrEqual(1);

    const request = receiver.requests.slice(before).find((r) => r.body.includes('inv_9'))!;
    expect(request).toBeDefined();
    expect(JSON.parse(request.body)).toEqual({ id: 'inv_9', amount: 12 });
    expect(request.headers['webhook-id']).toBe('msg_' + fixture.messageId);
    expect(request.headers['x-tenant']).toBe('acme');
    expect(request.headers['content-type']).toBe('application/json');
    expect(() =>
      verifyWebhook({ headers: request.headers, body: request.body, secrets: [fixture.secret] }),
    ).not.toThrow();

    expect(await rowOf(fixture.deliveryId)).toMatchObject({
      status: 'succeeded',
      attempt_count: 1,
      last_status_code: 200,
      last_error_class: null,
    });
    expect((await rowOf(fixture.deliveryId)).completed_at).not.toBeNull();
  });

  it('records every attempt in the history with a retention deadline', async () => {
    respond = () => 200;
    const fixture = await seedDelivery(t.db, { url: urlOf() });
    await t.dispatcher.drainOnce();
    const attempts = await waitFor(
      () =>
        t.attempts.listForDelivery(fixture.organizationId, fixture.messageId, fixture.endpointId),
      (rows) => rows.length >= 1,
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      deliveryId: fixture.deliveryId,
      attempt: 1,
      statusCode: 200,
      errorClass: null,
      responseBody: 'ok',
      nextAttemptAt: null,
    });
    const record = attempts[0] as unknown as { expiresAt: number; startedAt: string };
    const thirtyDays = 30 * 86_400;
    expect(record.expiresAt - Math.floor(Date.parse(record.startedAt) / 1000)).toBe(thirtyDays);
  });

  it('retries a failing receiver on the schedule and then gives up', async () => {
    respond = () => 503;
    const fixture = await seedDelivery(t.db, { url: urlOf() }); // schedule in tests: 0, 2, 4, 6 seconds
    const seen: { attempt: number; wait: number }[] = [];

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await waitFor(
        async () => (await rowOf(fixture.deliveryId)).next_attempt_at,
        (due) => due.getTime() <= Date.now(),
        10_000,
      );
      const before = Date.now();
      expect(await t.dispatcher.drainOnce()).toBeGreaterThanOrEqual(1);
      const row = await rowOf(fixture.deliveryId);
      expect(row.attempt_count).toBe(attempt);
      expect(row.last_status_code).toBe(503);
      expect(row.last_error_class).toBe('http_5xx');
      if (row.status === 'pending')
        seen.push({ attempt, wait: row.next_attempt_at.getTime() - before });
    }

    const final = await rowOf(fixture.deliveryId);
    expect(final).toMatchObject({ status: 'failed', attempt_count: 4 });
    expect(final.completed_at).not.toBeNull();
    expect(seen).toHaveLength(3);
    // After attempts 1, 2 and 3 the waits are 2 s, 4 s and 6 s, give or take 20 percent jitter.
    for (const [index, expected] of [2_000, 4_000, 6_000].entries()) {
      const wait = seen[index]!.wait;
      expect(wait).toBeGreaterThan(expected * 0.75);
      expect(wait).toBeLessThan(expected * 1.25);
    }

    const history = await t.attempts.listForDelivery(
      fixture.organizationId,
      fixture.messageId,
      fixture.endpointId,
    );
    expect(history.map((row) => row.attempt)).toEqual([1, 2, 3, 4]);
    expect(history.every((row) => row.statusCode === 503 && row.errorClass === 'http_5xx')).toBe(
      true,
    );
    expect(history[3]?.nextAttemptAt).toBeNull();
    expect(history[0]?.nextAttemptAt).not.toBeNull();
  }, 40_000);

  it('keeps the webhook id across attempts while the timestamp moves on', async () => {
    respond = () => 500;
    const before = receiver.requests.length;
    const fixture = await seedDelivery(t.db, { url: urlOf(), payload: { marker: 'stable-id' } });
    await t.dispatcher.drainOnce();
    await t.db.query(
      `update deliveries set next_attempt_at = now() - interval '1 second' where id = $1`,
      [fixture.deliveryId],
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await t.dispatcher.drainOnce();
    const mine = receiver.requests.slice(before).filter((r) => r.body.includes('stable-id'));
    expect(mine).toHaveLength(2);
    expect(mine[0]!.headers['webhook-id']).toBe(mine[1]!.headers['webhook-id']);
    expect(mine[0]!.headers['webhook-timestamp']).not.toBe(mine[1]!.headers['webhook-timestamp']);
  });
});
