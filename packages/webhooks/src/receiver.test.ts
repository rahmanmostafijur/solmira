import { describe, expect, it } from 'vitest';
import { WebhookPayloadError, parseWebhook } from './receiver.js';
import { WebhookVerificationError, signWebhook } from './standard-webhooks.js';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const NOW = 1614265330;

const request = (body: string) => ({
  headers: signWebhook({ id: 'msg_1', timestamp: NOW, body, secrets: [SECRET] }),
  body,
  secrets: [SECRET],
  now: NOW,
});

describe('parseWebhook', () => {
  it('returns the parsed body of a verified request', () => {
    expect(parseWebhook<{ test: number }>(request('{"test": 2432232314}'))).toEqual({
      test: 2432232314,
    });
  });

  it('accepts a Buffer body and decodes it as UTF-8', () => {
    const body = '{"name":"Zoë ✓"}';
    const input = request(body);
    expect(parseWebhook({ ...input, body: Buffer.from(body, 'utf8') })).toEqual({
      name: 'Zoë ✓',
    });
  });

  it('never parses a request that did not verify', () => {
    const input = request('{"a":1}');
    expect(() => parseWebhook({ ...input, body: '{"a":2}' })).toThrow(WebhookVerificationError);
  });

  it('separates a genuine request with a broken body from a forged one', () => {
    expect(() => parseWebhook(request('not json'))).toThrow(WebhookPayloadError);
  });
});
