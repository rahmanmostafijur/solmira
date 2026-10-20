import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks signing and verification (https://www.standardwebhooks.com/).
 *
 * The signed content is `<id>.<timestamp>.<body>`. The signature is `v1,` followed by the base64
 * HMAC-SHA256 of that content. Several signatures may be sent, separated by spaces, which is how
 * a secret rotation is bridged: the sender signs with the old and the new secret, and a receiver
 * that knows either one accepts the message.
 */

export const WEBHOOK_ID_HEADER = 'webhook-id';
export const WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';
export const WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

export const SECRET_PREFIX = 'whsec_';
export const SIGNATURE_VERSION = 'v1';
/** How far a timestamp may differ from the receiver's clock, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerificationFailure =
  | 'missing_headers'
  | 'invalid_timestamp'
  | 'timestamp_too_old'
  | 'timestamp_too_new'
  | 'no_matching_signature';

/** Why a webhook was rejected. The message never contains secrets or the expected signature. */
export class WebhookVerificationError extends Error {
  constructor(readonly reason: VerificationFailure) {
    super('Webhook verification failed: ' + reason);
    this.name = 'WebhookVerificationError';
  }
}

export interface SignedHeaders {
  readonly [WEBHOOK_ID_HEADER]: string;
  readonly [WEBHOOK_TIMESTAMP_HEADER]: string;
  readonly [WEBHOOK_SIGNATURE_HEADER]: string;
}

/** The raw key behind a secret: `whsec_` plus base64 (the prefix is optional). */
export function signingKey(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const key = Buffer.from(encoded, 'base64');
  if (key.length === 0) throw new Error('The signing secret is empty or not valid base64');
  return key;
}

function signatureOf(key: Buffer, id: string, timestamp: string, body: string | Buffer): string {
  const hmac = createHmac('sha256', key);
  hmac.update(id + '.' + timestamp + '.');
  hmac.update(body);
  return SIGNATURE_VERSION + ',' + hmac.digest('base64');
}

export interface SignInput {
  readonly id: string;
  /** Seconds since the Unix epoch. */
  readonly timestamp: number;
  readonly body: string | Buffer;
  /** One secret normally; two while a rotation is in progress. */
  readonly secrets: readonly string[];
}

/** The three headers for one request. Several secrets give several space-separated signatures. */
export function signWebhook(input: SignInput): SignedHeaders {
  if (input.secrets.length === 0) throw new Error('At least one signing secret is required');
  const timestamp = String(input.timestamp);
  const signatures = input.secrets.map((secret) =>
    signatureOf(signingKey(secret), input.id, timestamp, input.body),
  );
  return {
    [WEBHOOK_ID_HEADER]: input.id,
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: signatures.join(' '),
  };
}

export interface VerifyInput {
  /** Request headers; names are matched without regard to case. */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The raw request body, exactly as received. Parsing and re-serializing changes the bytes. */
  readonly body: string | Buffer;
  /** The secret, or several while the receiver rotates its own. */
  readonly secrets: readonly string[];
  readonly toleranceSeconds?: number;
  /** Seconds since the Unix epoch; defaults to the current time. */
  readonly now?: number;
}

function header(headers: VerifyInput['headers'], name: string): string | undefined {
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  return undefined;
}

/** Throws `WebhookVerificationError` unless the request is fresh and carries a valid signature. */
export function verifyWebhook(input: VerifyInput): void {
  const id = header(input.headers, WEBHOOK_ID_HEADER);
  const timestamp = header(input.headers, WEBHOOK_TIMESTAMP_HEADER);
  const signatures = header(input.headers, WEBHOOK_SIGNATURE_HEADER);
  if (!id || !timestamp || !signatures) throw new WebhookVerificationError('missing_headers');
  if (!/^\d{1,12}$/.test(timestamp)) throw new WebhookVerificationError('invalid_timestamp');

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const age = now - Number(timestamp);
  if (age > tolerance) throw new WebhookVerificationError('timestamp_too_old');
  if (age < -tolerance) throw new WebhookVerificationError('timestamp_too_new');

  const provided = signatures
    .split(' ')
    .filter((entry) => entry.startsWith(SIGNATURE_VERSION + ','))
    .map((entry) => Buffer.from(entry, 'utf8'));
  const keys = input.secrets.map(signingKey);
  const matches = keys.some((key) => {
    const expected = Buffer.from(signatureOf(key, id, timestamp, input.body), 'utf8');
    return provided.some(
      (candidate) => candidate.length === expected.length && timingSafeEqual(candidate, expected),
    );
  });
  if (!matches) throw new WebhookVerificationError('no_matching_signature');
}
