import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  readonly id: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly body: string;
}

/**
 * A webhook receiver of the test's own. It records every delivery and answers with whatever status
 * the test sets, so the test controls success and failure. Signatures are checked here with
 * node:crypto, independently of the platform's own signing code.
 */
export class TestReceiver {
  readonly received: ReceivedWebhook[] = [];
  status = 200;
  private server: Server | undefined;

  get url(): string {
    const address = this.server?.address() as AddressInfo | null | undefined;
    if (!address) throw new Error('The receiver is not listening');
    return `http://127.0.0.1:${address.port}/hook`;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        this.received.push({
          id: String(request.headers['webhook-id'] ?? ''),
          timestamp: String(request.headers['webhook-timestamp'] ?? ''),
          signature: String(request.headers['webhook-signature'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        response.statusCode = this.status;
        response.end(this.status === 200 ? 'ok' : 'receiver is failing on purpose');
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

/** Standard Webhooks: HMAC-SHA256 over `id.timestamp.body` with the base64-decoded secret. */
export function isValidSignature(secret: string, webhook: ReceivedWebhook): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${webhook.id}.${webhook.timestamp}.${webhook.body}`)
    .digest();
  return webhook.signature.split(' ').some((candidate) => {
    const [version, value] = candidate.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
