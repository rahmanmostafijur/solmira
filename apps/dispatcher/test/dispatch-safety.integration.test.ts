import { verifyWebhook } from '@solmira/webhooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './support/test-server.js';
import { seedDelivery } from './support/seed.js';
import { createTestDispatcher, waitFor, type TestDispatcher } from './support/test-app.js';

/** Strict target rules (what production uses), with the loopback receiver as the thing to protect. */
describe('sending safely', () => {
  let strict: TestDispatcher;
  let lenient: TestDispatcher;
  let receiver: TestServer;
  let behaviour: 'ok' | 'redirect' | 'silent' = 'ok';

  beforeAll(async () => {
    receiver = await startServer((_request, response) => {
      if (behaviour === 'silent') return;
      if (behaviour === 'redirect')
        response.writeHead(302, { location: 'http://127.0.0.1:1/' }).end();
      else response.writeHead(200).end('ok');
    });
    strict = await createTestDispatcher(
      { ALLOW_PRIVATE_ENDPOINT_TARGETS: 'false' },
      async (host) => (host === 'public.example' ? ['93.184.216.34'] : ['10.0.0.9']),
    );
    lenient = await createTestDispatcher({
      DELIVERY_TIMEOUT_MS: '700',
      DELIVERY_MAX_PAYLOAD_BYTES: '2048',
    });
  });
  afterAll(async () => {
    await receiver.close();
    await strict.close();
    await lenient.close();
  });

  const state = async (t: TestDispatcher, deliveryId: string) =>
    (
      await t.db.query(
        'select status, attempt_count, last_error_class, last_status_code, next_attempt_at from deliveries where id = $1',
        [deliveryId],
      )
    ).rows[0];

  it('never lets the receiver see a request to a private or loopback target, and retries later', async () => {
    const before = receiver.requests.length;
    const targets = [
      'http://127.0.0.1:' + receiver.port + '/a',
      'http://internal.example:' + receiver.port + '/b', // resolves to a private address
      'http://169.254.169.254/latest/meta-data/',
    ];
    for (const url of targets) {
      const fixture = await seedDelivery(strict.db, { url });
      await strict.dispatcher.drainOnce();
      const row = await state(strict, fixture.deliveryId);
      expect({ url, status: row.status, errorClass: row.last_error_class }).toEqual({
        url,
        status: 'pending',
        errorClass: 'ssrf_blocked',
      });
      const history = await waitFor(
        () =>
          strict.attempts.listForDelivery(
            fixture.organizationId,
            fixture.messageId,
            fixture.endpointId,
          ),
        (rows) => rows.length > 0,
      );
      expect(history[0]).toMatchObject({ errorClass: 'ssrf_blocked', statusCode: null });
    }
    expect(receiver.requests.length).toBe(before);
  });

  it('does not follow a redirect and treats it as a failed attempt', async () => {
    behaviour = 'redirect';
    const fixture = await seedDelivery(lenient.db, { url: 'http://hooks.test:' + receiver.port });
    await lenient.dispatcher.drainOnce();
    expect(await state(lenient, fixture.deliveryId)).toMatchObject({
      status: 'pending',
      last_error_class: 'redirect',
      last_status_code: 302,
    });
  });

  it('stops waiting for a receiver that never answers', async () => {
    behaviour = 'silent';
    const fixture = await seedDelivery(lenient.db, { url: 'http://hooks.test:' + receiver.port });
    const started = Date.now();
    await lenient.dispatcher.drainOnce();
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await state(lenient, fixture.deliveryId)).toMatchObject({
      status: 'pending',
      last_error_class: 'timeout',
      last_status_code: null,
    });
    behaviour = 'ok';
  });

  it('refuses disabled and archived endpoints and oversized payloads without sending', async () => {
    behaviour = 'ok';
    const url = 'http://hooks.test:' + receiver.port;
    const disabled = await seedDelivery(lenient.db, { url, enabled: false });
    const archived = await seedDelivery(lenient.db, { url, archived: true });
    const large = await seedDelivery(lenient.db, { url, payload: { blob: 'x'.repeat(4096) } });
    await lenient.dispatcher.drainOnce();
    for (const [fixture, reason] of [
      [disabled, 'endpoint_unavailable'],
      [archived, 'endpoint_unavailable'],
      [large, 'payload_too_large'],
    ] as const)
      expect(await state(lenient, fixture.deliveryId)).toMatchObject({
        status: 'failed',
        last_error_class: reason,
        attempt_count: 1,
      });
    // Only these messages count: retries of the earlier tests may fall due during this drain.
    const ids = new Set([disabled, archived, large].map((f) => 'msg_' + f.messageId));
    expect(receiver.requests.filter((r) => ids.has(String(r.headers['webhook-id'])))).toEqual([]);
  });

  it('signs with the active and the previous secret during a rotation window', async () => {
    behaviour = 'ok';
    const before = receiver.requests.length;
    const fixture = await seedDelivery(lenient.db, {
      url: 'http://hooks.test:' + receiver.port,
      previousSecret: true,
      payload: { marker: 'rotating' },
    });
    await lenient.dispatcher.drainOnce();
    const request = receiver.requests.slice(before).find((r) => r.body.includes('rotating'))!;
    expect(request.headers['webhook-signature']).toMatch(/^v1,\S+ v1,\S+$/);
    for (const secret of [fixture.secret, fixture.previousSecret!])
      expect(() =>
        verifyWebhook({ headers: request.headers, body: request.body, secrets: [secret] }),
      ).not.toThrow();
  });
});
