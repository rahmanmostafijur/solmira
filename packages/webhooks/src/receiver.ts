import { verifyWebhook, type VerifyInput } from './standard-webhooks.js';

/** The signature was valid but the body is not JSON. */
export class WebhookPayloadError extends Error {
  constructor() {
    super('The webhook body is not valid JSON');
    this.name = 'WebhookPayloadError';
  }
}

/**
 * Verifies a webhook and returns its body parsed as JSON, so a handler never sees a payload that
 * was not verified. Throws `WebhookVerificationError` (the request is not from the sender, is too
 * old or too new, or was altered) or `WebhookPayloadError` (genuine, but not JSON).
 *
 * Pass the body exactly as it arrived: parsing and re-serializing it changes the bytes the
 * signature covers.
 */
export function parseWebhook<T = unknown>(input: VerifyInput): T {
  verifyWebhook(input);
  try {
    return JSON.parse(
      typeof input.body === 'string' ? input.body : input.body.toString('utf8'),
    ) as T;
  } catch {
    throw new WebhookPayloadError();
  }
}
