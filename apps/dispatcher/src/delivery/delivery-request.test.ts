import { verifyWebhook } from '@solmira/webhooks';
import { describe, expect, it } from 'vitest';
import { buildDeliveryRequest, webhookIdOf } from './delivery-request.js';

const SECRET = 'whsec_' + Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const OLD_SECRET = 'whsec_' + Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');
const MESSAGE = '0190b0a0-7c5e-7000-8000-000000000001';
const NOW = new Date('2026-10-21T12:00:00Z');

const build = (overrides: Partial<Parameters<typeof buildDeliveryRequest>[0]> = {}) =>
  buildDeliveryRequest({
    messageId: MESSAGE,
    payload: { id: 'inv_1', amount: 5 },
    customHeaders: { 'x-tenant': 'acme' },
    secrets: [SECRET],
    now: NOW,
    ...overrides,
  });

describe('buildDeliveryRequest', () => {
  it('produces a request a Standard Webhooks receiver accepts', () => {
    const request = build();
    expect(request.body).toBe('{"id":"inv_1","amount":5}');
    expect(request.headers['webhook-id']).toBe('msg_' + MESSAGE);
    expect(request.headers['webhook-timestamp']).toBe(String(Math.floor(NOW.getTime() / 1000)));
    expect(() =>
      verifyWebhook({
        headers: request.headers,
        body: request.body,
        secrets: [SECRET],
        now: Math.floor(NOW.getTime() / 1000),
      }),
    ).not.toThrow();
  });

  it('is rejected by a receiver when the body, id or timestamp is altered', () => {
    const request = build();
    const now = Math.floor(NOW.getTime() / 1000);
    const check = (headers: Record<string, string>, body: string) =>
      verifyWebhook({ headers, body, secrets: [SECRET], now });
    expect(() => check(request.headers, request.body + ' ')).toThrow('no_matching_signature');
    expect(() => check({ ...request.headers, 'webhook-id': 'msg_x' }, request.body)).toThrow(
      'no_matching_signature',
    );
    expect(() =>
      check({ ...request.headers, 'webhook-timestamp': String(now - 1) }, request.body),
    ).toThrow('no_matching_signature');
  });

  it('keeps the webhook id across attempts while the timestamp and signature move on', () => {
    const first = build();
    const retry = build({ now: new Date(NOW.getTime() + 5_000) });
    expect(retry.headers['webhook-id']).toBe(first.headers['webhook-id']);
    expect(retry.headers['webhook-timestamp']).not.toBe(first.headers['webhook-timestamp']);
    expect(retry.headers['webhook-signature']).not.toBe(first.headers['webhook-signature']);
    expect(webhookIdOf(MESSAGE)).toBe('msg_' + MESSAGE);
  });

  it('signs with both secrets during a rotation, so a receiver with either one accepts it', () => {
    const request = build({ secrets: [SECRET, OLD_SECRET] });
    expect(request.headers['webhook-signature']?.split(' ')).toHaveLength(2);
    const now = Math.floor(NOW.getTime() / 1000);
    for (const secret of [SECRET, OLD_SECRET])
      expect(() =>
        verifyWebhook({ headers: request.headers, body: request.body, secrets: [secret], now }),
      ).not.toThrow();
  });

  it('keeps the platform headers even when the tenant tries to set them', () => {
    const request = build({
      customHeaders: {
        'content-type': 'text/plain',
        'user-agent': 'evil',
        'webhook-id': 'msg_forged',
        'x-tenant': 'acme',
      },
    });
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['user-agent']).toBe('Solmira-Webhooks/1.0');
    expect(request.headers['webhook-id']).toBe('msg_' + MESSAGE);
    expect(request.headers['x-tenant']).toBe('acme');
  });
});
