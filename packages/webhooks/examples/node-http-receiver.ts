/**
 * A webhook receiver on plain `node:http`, with no framework. Outside this repository import from
 * '@solmira/webhooks' instead of the relative path.
 *
 * What it demonstrates, in the order a request meets it:
 *  1. only POST is accepted;
 *  2. the body is read as raw bytes with a size limit (verification needs the exact bytes, so do not
 *     put a JSON body parser in front of it);
 *  3. the signature and timestamp are verified before anything else is looked at;
 *  4. a webhook-id that was already handled is acknowledged and ignored (delivery is at least once);
 *  5. the handler runs, and the receiver answers 2xx quickly.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebhookPayloadError, WebhookVerificationError, parseWebhook } from '../src/index.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REMEMBERED_IDS = 10_000;

export interface ReceiverOptions {
  /** The signing secret; give two while you are rotating yours, so either one verifies. */
  readonly secrets: readonly string[];
  readonly onEvent: (event: unknown, webhookId: string) => void | Promise<void>;
  readonly toleranceSeconds?: number;
  /** Seconds since the epoch; only tests set this. */
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

class BodyTooLarge extends Error {}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createReceiver(options: ReceiverOptions): Server {
  // In production keep this in a shared store with an expiry (Redis, a database unique key).
  const handled = new Set<string>();
  const log = options.log ?? (() => undefined);

  return createServer(async (request, response) => {
    const reply = (status: number, text = '') => response.writeHead(status).end(text);
    if (request.method !== 'POST') return reply(405);

    let body: Buffer;
    try {
      body = await readRawBody(request);
    } catch (error) {
      return reply(error instanceof BodyTooLarge ? 413 : 400);
    }

    let event: unknown;
    try {
      event = parseWebhook({
        headers: request.headers,
        body,
        secrets: options.secrets,
        ...(options.toleranceSeconds !== undefined && {
          toleranceSeconds: options.toleranceSeconds,
        }),
        ...(options.now && { now: options.now() }),
      });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        // Log the reason for yourself; the sender (or an attacker) learns only that it was refused.
        log(`rejected: ${error.reason}`);
        return reply(400);
      }
      if (error instanceof WebhookPayloadError) return reply(400);
      throw error;
    }

    const webhookId = String(request.headers['webhook-id']);
    if (handled.has(webhookId)) return reply(200, 'duplicate');
    try {
      await options.onEvent(event, webhookId);
    } catch (error) {
      // A 5xx tells the sender to try again later; the id is not remembered, so the retry runs.
      log(`handler failed: ${String(error)}`);
      return reply(500);
    }
    handled.add(webhookId);
    if (handled.size > MAX_REMEMBERED_IDS) handled.delete(handled.values().next().value as string);
    return reply(204);
  });
}
