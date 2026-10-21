/**
 * The same receiver as a function from `Request` to `Response`, the shape used by Next.js route
 * handlers, Hono, Remix, Cloudflare Workers, Deno and Bun. Outside this repository import from
 * '@solmira/webhooks' instead of the relative path.
 *
 * Next.js: app/api/webhooks/route.ts
 *
 *   const handle = createWebhookHandler({ secrets: [process.env.WEBHOOK_SECRET!], onEvent });
 *   export const POST = handle;
 */
import { WebhookPayloadError, WebhookVerificationError, parseWebhook } from '../src/index.js';

export interface HandlerOptions {
  readonly secrets: readonly string[];
  readonly onEvent: (event: unknown, webhookId: string) => void | Promise<void>;
  readonly now?: () => number;
}

export function createWebhookHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    // `text()` returns the body exactly as sent. Do not use `json()`: it would hide the bytes
    // that were signed.
    const body = await request.text();
    const headers = Object.fromEntries(request.headers.entries());

    let event: unknown;
    try {
      event = parseWebhook({
        headers,
        body,
        secrets: options.secrets,
        ...(options.now && { now: options.now() }),
      });
    } catch (error) {
      if (error instanceof WebhookVerificationError || error instanceof WebhookPayloadError) {
        return new Response(null, { status: 400 });
      }
      throw error;
    }

    await options.onEvent(event, headers['webhook-id'] ?? '');
    return new Response(null, { status: 204 });
  };
}
