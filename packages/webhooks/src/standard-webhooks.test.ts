import { describe, expect, it } from 'vitest';
import {
  signWebhook,
  signingKey,
  verifyWebhook,
  type VerificationFailure,
  type WebhookVerificationError,
} from './standard-webhooks.js';

// The reference example from the Standard Webhooks and Svix documentation.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TIMESTAMP = 1614265330;
const BODY = '{"test": 2432232314}';
const SIGNATURE = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

const signed = () => signWebhook({ id: ID, timestamp: TIMESTAMP, body: BODY, secrets: [SECRET] });
const verify = (overrides: Partial<Parameters<typeof verifyWebhook>[0]> = {}) =>
  verifyWebhook({ headers: signed(), body: BODY, secrets: [SECRET], now: TIMESTAMP, ...overrides });
const failureOf = (run: () => void): VerificationFailure | undefined => {
  try {
    run();
  } catch (error) {
    return (error as WebhookVerificationError).reason;
  }
  return undefined;
};

describe('signWebhook', () => {
  it('produces the documented signature for the reference example', () => {
    expect(signed()).toEqual({
      'webhook-id': ID,
      'webhook-timestamp': String(TIMESTAMP),
      'webhook-signature': SIGNATURE,
    });
  });

  it('signs a Buffer body the same way as the equivalent string', () => {
    const headers = signWebhook({
      id: ID,
      timestamp: TIMESTAMP,
      body: Buffer.from(BODY),
      secrets: [SECRET],
    });
    expect(headers['webhook-signature']).toBe(SIGNATURE);
  });

  it('accepts the secret with or without the whsec_ prefix', () => {
    const bare = SECRET.slice('whsec_'.length);
    expect(signWebhook({ id: ID, timestamp: TIMESTAMP, body: BODY, secrets: [bare] })).toEqual(
      signed(),
    );
  });

  it('signs with every secret during a rotation, in order, separated by spaces', () => {
    const next = 'whsec_' + Buffer.from('a-brand-new-signing-key-0123456789').toString('base64');
    const headers = signWebhook({
      id: ID,
      timestamp: TIMESTAMP,
      body: BODY,
      secrets: [SECRET, next],
    });
    const [first, second] = headers['webhook-signature'].split(' ');
    expect(first).toBe(SIGNATURE);
    expect(second).toMatch(/^v1,[A-Za-z0-9+/]+=*$/);
    expect(second).not.toBe(first);
  });

  it('refuses to sign without a secret or with an unusable one', () => {
    expect(() => signWebhook({ id: ID, timestamp: 1, body: '', secrets: [] })).toThrow(
      'At least one',
    );
    expect(() => signingKey('whsec_')).toThrow('empty');
  });
});

describe('verifyWebhook', () => {
  it('accepts the reference example', () => {
    expect(() => verify()).not.toThrow();
  });

  it('matches header names without regard to case', () => {
    const headers = Object.fromEntries(
      Object.entries(signed()).map(([k, v]) => [k.toUpperCase(), v]),
    );
    expect(() => verify({ headers })).not.toThrow();
  });

  it('rejects a tampered id, timestamp or body', () => {
    expect(failureOf(() => verify({ headers: { ...signed(), 'webhook-id': 'msg_other' } }))).toBe(
      'no_matching_signature',
    );
    expect(
      failureOf(() =>
        verify({ headers: { ...signed(), 'webhook-timestamp': String(TIMESTAMP + 1) } }),
      ),
    ).toBe('no_matching_signature');
    expect(failureOf(() => verify({ body: BODY + ' ' }))).toBe('no_matching_signature');
    expect(failureOf(() => verify({ body: '{"test":2432232314}' }))).toBe('no_matching_signature');
  });

  it('rejects a signature made with another secret', () => {
    const other = 'whsec_' + Buffer.from('another-secret-another-secret-123').toString('base64');
    expect(failureOf(() => verify({ secrets: [other] }))).toBe('no_matching_signature');
  });

  it('rejects missing headers and malformed timestamps', () => {
    for (const name of ['webhook-id', 'webhook-timestamp', 'webhook-signature']) {
      const { [name as 'webhook-id']: _removed, ...rest } = signed();
      expect(
        failureOf(() => verify({ headers: rest })),
        name,
      ).toBe('missing_headers');
    }
    for (const timestamp of ['abc', '-5', '1.5', '', '99999999999999'])
      expect(
        failureOf(() => verify({ headers: { ...signed(), 'webhook-timestamp': timestamp } })),
        timestamp,
      ).toMatch(/invalid_timestamp|missing_headers/);
  });

  it('enforces the timestamp tolerance in both directions', () => {
    expect(() => verify({ now: TIMESTAMP + 300 })).not.toThrow();
    expect(failureOf(() => verify({ now: TIMESTAMP + 301 }))).toBe('timestamp_too_old');
    expect(() => verify({ now: TIMESTAMP - 300 })).not.toThrow();
    expect(failureOf(() => verify({ now: TIMESTAMP - 301 }))).toBe('timestamp_too_new');
    expect(() => verify({ now: TIMESTAMP + 3600, toleranceSeconds: 7200 })).not.toThrow();
  });

  it('accepts any one of several signatures and ignores unknown versions', () => {
    const next = 'whsec_' + Buffer.from('a-brand-new-signing-key-0123456789').toString('base64');
    const rotating = signWebhook({
      id: ID,
      timestamp: TIMESTAMP,
      body: BODY,
      secrets: [SECRET, next],
    });
    expect(() => verify({ headers: rotating, secrets: [SECRET] })).not.toThrow();
    expect(() => verify({ headers: rotating, secrets: [next] })).not.toThrow();
    const unknownFirst = {
      ...rotating,
      'webhook-signature': 'v2,abcd ' + rotating['webhook-signature'],
    };
    expect(() => verify({ headers: unknownFirst, secrets: [next] })).not.toThrow();
    const onlyUnknown = { ...rotating, 'webhook-signature': 'v2,abcd v1a,efgh' };
    expect(failureOf(() => verify({ headers: onlyUnknown }))).toBe('no_matching_signature');
  });

  it('does not reveal secrets or signatures in its error', () => {
    try {
      verify({ body: 'tampered' });
    } catch (error) {
      const text = String((error as Error).message) + JSON.stringify(error);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SIGNATURE);
    }
  });
});
