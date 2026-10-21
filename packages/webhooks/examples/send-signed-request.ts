/**
 * Sends a signed webhook to a URL, the way the platform does. Useful to try a receiver locally:
 *
 *   node --experimental-strip-types examples/send-signed-request.ts http://localhost:3000/webhooks whsec_...
 *
 * Outside this repository import from '@solmira/webhooks' instead of the relative path.
 */
import { randomUUID } from 'node:crypto';
import { signWebhook } from '../src/index.js';

export async function sendSignedRequest(
  url: string,
  secrets: readonly string[],
  payload: unknown,
  options: { id?: string; timestamp?: number } = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers = signWebhook({
    id: options.id ?? `msg_${randomUUID()}`,
    timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
    body,
    secrets,
  });
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}
