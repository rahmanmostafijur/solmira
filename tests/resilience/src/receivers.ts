import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifyWebhook } from '@solmira/webhooks';

export type ReceiverMode =
  | { readonly kind: 'ok' }
  /** Answers with a status, for example 500. */
  | { readonly kind: 'status'; readonly status: number }
  /** Takes this long to answer 200; the sender may give up first. */
  | { readonly kind: 'slow'; readonly delayMs: number };

export interface Receipt {
  readonly webhookId: string;
  readonly receivedAt: number;
  readonly signatureValid: boolean;
  readonly body: string;
}

/**
 * A customer's server. It records every request it gets (even one the sender stopped waiting for),
 * checks the signature with the endpoint's secret, and can be switched between answering normally,
 * answering with errors, being slow, and being down (not listening at all).
 */
export class Receiver {
  readonly receipts: Receipt[] = [];
  secret = '';
  mode: ReceiverMode = { kind: 'ok' };
  private server: Server | undefined;
  private port = 0;

  get url(): string {
    return `http://127.0.0.1:${this.port}/hook`;
  }

  /** Distinct webhook ids received, which is what at-least-once delivery has to cover. */
  get distinctIds(): Set<string> {
    return new Set(this.receipts.map((receipt) => receipt.webhookId));
  }

  /** Starts listening; after `goDown`, comes back on the same port so the endpoint URL stays valid. */
  async listen(): Promise<void> {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        this.receipts.push({
          webhookId: String(request.headers['webhook-id'] ?? ''),
          receivedAt: Date.now(),
          signatureValid: this.isSigned(request.headers, body),
          body,
        });
        const mode = this.mode;
        if (mode.kind === 'status') return void response.writeHead(mode.status).end('failing');
        if (mode.kind === 'slow') {
          return void setTimeout(() => {
            if (!response.destroyed) response.writeHead(200).end('ok');
          }, mode.delayMs);
        }
        response.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', resolve);
    });
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
  }

  /** Not listening: connections are refused, as for a server that is down. */
  async goDown(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private isSigned(headers: Record<string, string | string[] | undefined>, body: string): boolean {
    if (!this.secret) return false;
    try {
      verifyWebhook({ headers, body, secrets: [this.secret], toleranceSeconds: 3600 });
      return true;
    } catch {
      return false;
    }
  }
}
