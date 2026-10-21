import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { signWebhook } from '../src/index.js';
import { createReceiver } from './node-http-receiver.js';
import { sendSignedRequest } from './send-signed-request.js';
import { createWebhookHandler } from './web-standard-handler.js';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const NEXT_SECRET = 'whsec_' + Buffer.from('a-brand-new-signing-key-0123456789').toString('base64');
const NOW = 1_700_000_000;

describe('node:http receiver example', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function start(secrets: string[] = [SECRET]) {
    const events: { event: unknown; id: string }[] = [];
    let failNext = false;
    const server = createReceiver({
      secrets,
      now: () => NOW,
      onEvent: (event, id) => {
        if (failNext) {
          failNext = false;
          throw new Error('database down');
        }
        events.push({ event, id });
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks`;
    return { url, events, failOnce: () => (failNext = true) };
  }
  const send = (
    url: string,
    payload: unknown,
    options: Parameters<typeof sendSignedRequest>[3] = {},
    secrets = [SECRET],
  ) => sendSignedRequest(url, secrets, payload, { timestamp: NOW, ...options });

  it('hands a verified event to the handler and answers 204', async () => {
    const { url, events } = await start();
    const response = await send(url, { invoice: 'inv_1' }, { id: 'msg_a' });
    expect(response.status).toBe(204);
    expect(events).toEqual([{ event: { invoice: 'inv_1' }, id: 'msg_a' }]);
  });

  it('refuses a request signed with another secret, a stale one and a tampered one', async () => {
    const { url, events } = await start();
    expect((await send(url, {}, {}, [NEXT_SECRET])).status).toBe(400);
    expect((await send(url, {}, { timestamp: NOW - 3600 })).status).toBe(400);

    const body = '{"amount":1}';
    const headers = signWebhook({ id: 'msg_t', timestamp: NOW, body, secrets: [SECRET] });
    const tampered = await fetch(url, { method: 'POST', headers, body: '{"amount":9999}' });
    expect(tampered.status).toBe(400);
    expect(events).toEqual([]);
  });

  it('accepts either secret while rotating, and a sender signing with both', async () => {
    const { url, events } = await start([NEXT_SECRET, SECRET]);
    expect((await send(url, { n: 1 }, { id: 'msg_1' }, [SECRET])).status).toBe(204);
    expect((await send(url, { n: 2 }, { id: 'msg_2' }, [NEXT_SECRET])).status).toBe(204);
    expect((await send(url, { n: 3 }, { id: 'msg_3' }, [SECRET, NEXT_SECRET])).status).toBe(204);
    expect(events).toHaveLength(3);
  });

  it('acknowledges a repeated webhook-id without handling it twice', async () => {
    const { url, events } = await start();
    expect((await send(url, { n: 1 }, { id: 'msg_same' })).status).toBe(204);
    const again = await send(url, { n: 1 }, { id: 'msg_same' });
    expect(again.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it('answers 500 when the handler fails, and handles the retry', async () => {
    const { url, events, failOnce } = await start();
    failOnce();
    expect((await send(url, { n: 1 }, { id: 'msg_retry' })).status).toBe(500);
    expect((await send(url, { n: 1 }, { id: 'msg_retry' })).status).toBe(204);
    expect(events).toHaveLength(1);
  });

  it('refuses other methods, oversized bodies and a genuine request that is not JSON', async () => {
    const { url } = await start();
    expect((await fetch(url, { method: 'GET' })).status).toBe(405);
    expect((await send(url, 'x'.repeat(1024 * 1024 + 1))).status).toBe(413);

    const body = 'not json';
    const headers = signWebhook({ id: 'msg_n', timestamp: NOW, body, secrets: [SECRET] });
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(400);
  });
});

describe('Request/Response handler example', () => {
  const events: unknown[] = [];
  const handle = createWebhookHandler({
    secrets: [SECRET],
    now: () => NOW,
    onEvent: (event) => void events.push(event),
  });
  const post = (body: string, headers: Record<string, string>) =>
    handle(new Request('https://example.test/api/webhooks', { method: 'POST', headers, body }));

  it('verifies the raw body of a standard Request', async () => {
    const body = '{"order":"o_1"}';
    const headers = signWebhook({ id: 'msg_w', timestamp: NOW, body, secrets: [SECRET] });
    expect((await post(body, headers)).status).toBe(204);
    expect(events).toEqual([{ order: 'o_1' }]);
  });

  it('refuses a request that does not verify', async () => {
    const headers = signWebhook({
      id: 'msg_x',
      timestamp: NOW,
      body: '{"a":1}',
      secrets: [SECRET],
    });
    expect((await post('{"a":2}', headers)).status).toBe(400);
    expect(events).toHaveLength(1);
  });
});
