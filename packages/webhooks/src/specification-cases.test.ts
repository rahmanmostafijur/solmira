import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  WebhookVerificationError,
  signWebhook,
  signingKey,
  verifyWebhook,
  type VerificationFailure,
} from './standard-webhooks.js';

/**
 * The behaviours the Standard Webhooks reference libraries check (modelled on the cases in the
 * official JavaScript library's test suite), run against this implementation. The expected
 * signatures are computed here with node:crypto from the specification's recipe, not with the
 * code under test.
 */
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const BODY = '{"test": 2432232314}';
const BARE_SECRET = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const TOLERANCE = 5 * 60;
const NOW = 1_700_000_000;

/** The specification's recipe: HMAC-SHA256 over `id.timestamp.body` with the decoded secret. */
const reference = (timestamp: number, body: string = BODY, secret: string = BARE_SECRET) =>
  'v1,' +
  createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${ID}.${timestamp}.${body}`)
    .digest('base64');

const headersFor = (timestamp: number, signature = reference(timestamp)) => ({
  'webhook-id': ID,
  'webhook-timestamp': String(timestamp),
  'webhook-signature': signature,
});

const reasonOf = (run: () => void): VerificationFailure | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof WebhookVerificationError) return error.reason;
    throw error;
  }
  return undefined;
};

const verify = (
  headers: Record<string, string>,
  options: { secrets?: string[]; now?: number } = {},
) =>
  verifyWebhook({
    headers,
    body: BODY,
    secrets: options.secrets ?? [BARE_SECRET],
    now: options.now ?? NOW,
  });

describe('specification cases', () => {
  it('signs exactly as the specification describes', () => {
    const signed = signWebhook({ id: ID, timestamp: NOW, body: BODY, secrets: [BARE_SECRET] });
    expect(signed['webhook-signature']).toBe(reference(NOW));
  });

  it('refuses an empty or unusable secret', () => {
    for (const secret of [
      '',
      'whsec_',
      undefined as unknown as string,
      null as unknown as string,
    ]) {
      expect(() => signingKey(secret), String(secret)).toThrow();
    }
  });

  it('refuses a request missing the id, the timestamp or the signature', () => {
    for (const missing of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const headers: Record<string, string> = headersFor(NOW);
      delete headers[missing];
      expect(
        reasonOf(() => verify(headers)),
        missing,
      ).toBe('missing_headers');
    }
  });

  it('refuses a timestamp that is not a number', () => {
    expect(reasonOf(() => verify({ ...headersFor(NOW), 'webhook-timestamp': 'hello' }))).toBe(
      'invalid_timestamp',
    );
  });

  it('refuses a garbage, a partial and an empty signature', () => {
    const good = reference(NOW);
    for (const signature of ['v1,dawfeoifkpqwoekfpqoekf', good.slice(0, 8), 'v1,', 'v1', '']) {
      expect(
        reasonOf(() => verify(headersFor(NOW, signature))),
        signature,
      ).toBeDefined();
    }
  });

  it('accepts a valid signature, with or without the whsec_ prefix on the secret', () => {
    expect(() => verify(headersFor(NOW))).not.toThrow();
    expect(() => verify(headersFor(NOW), { secrets: ['whsec_' + BARE_SECRET] })).not.toThrow();
  });

  it('accepts the same headers under any capitalization', () => {
    const headers = headersFor(NOW);
    const shouting = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toUpperCase(), v]),
    );
    expect(() => verify(shouting)).not.toThrow();
  });

  it('refuses a timestamp outside the tolerance, in both directions, and accepts the edge', () => {
    expect(() => verify(headersFor(NOW - TOLERANCE))).not.toThrow();
    expect(reasonOf(() => verify(headersFor(NOW - TOLERANCE - 1)))).toBe('timestamp_too_old');
    expect(() => verify(headersFor(NOW + TOLERANCE))).not.toThrow();
    expect(reasonOf(() => verify(headersFor(NOW + TOLERANCE + 1)))).toBe('timestamp_too_new');
  });

  it('accepts a request that carries several signatures when any one is valid', () => {
    const other = 'v1,' + Buffer.from('x'.repeat(32)).toString('base64');
    expect(() => verify(headersFor(NOW, `${other} ${reference(NOW)}`))).not.toThrow();
    expect(() => verify(headersFor(NOW, `${reference(NOW)} ${other}`))).not.toThrow();
    expect(reasonOf(() => verify(headersFor(NOW, `${other} ${other}`)))).toBe(
      'no_matching_signature',
    );
  });

  it('accepts a request signed by a rotated-out secret while the receiver knows both', () => {
    const next = Buffer.from('a-brand-new-signing-key-0123456789').toString('base64');
    expect(() => verify(headersFor(NOW), { secrets: [next, BARE_SECRET] })).not.toThrow();
    expect(reasonOf(() => verify(headersFor(NOW), { secrets: [next] }))).toBe(
      'no_matching_signature',
    );
  });

  it('covers every byte of the body, including multi-byte characters', () => {
    const body = '{"name":"Zoë ✓ \u{1F600}"}';
    const signature = reference(NOW, body);
    expect(() =>
      verifyWebhook({
        headers: headersFor(NOW, signature),
        body,
        secrets: [BARE_SECRET],
        now: NOW,
      }),
    ).not.toThrow();
    expect(() =>
      verifyWebhook({
        headers: headersFor(NOW, signature),
        body: Buffer.from(body, 'utf8'),
        secrets: [BARE_SECRET],
        now: NOW,
      }),
    ).not.toThrow();
    expect(
      reasonOf(() =>
        verifyWebhook({
          headers: headersFor(NOW, signature),
          body: body + ' ',
          secrets: [BARE_SECRET],
          now: NOW,
        }),
      ),
    ).toBe('no_matching_signature');
  });

  it('signs and verifies an empty body', () => {
    const headers = headersFor(NOW, reference(NOW, ''));
    expect(() =>
      verifyWebhook({ headers, body: '', secrets: [BARE_SECRET], now: NOW }),
    ).not.toThrow();
  });
});
