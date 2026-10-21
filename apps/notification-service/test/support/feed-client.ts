import { WebSocket } from 'ws';

export interface Closed {
  readonly code: number;
  readonly reason: string;
}

/** A feed client that records every frame and when and why it was closed. */
export class FeedClient {
  readonly frames: Record<string, any>[] = [];
  readonly closed: Promise<Closed>;
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => this.frames.push(JSON.parse(raw.toString('utf8'))));
    this.closed = new Promise((resolve) =>
      socket.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })),
    );
  }

  static async open(url: string): Promise<FeedClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new FeedClient(socket);
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  authenticate(token: string): void {
    this.sendRaw(JSON.stringify({ type: 'auth', token }));
  }

  /** Waits until a frame matching the predicate has arrived. */
  async waitFor(match: (frame: Record<string, any>) => boolean, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.frames.find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('No matching frame arrived; got ' + JSON.stringify(this.frames));
  }

  close(): void {
    this.socket.close();
  }
}

/** Resolves with the failure of a connection attempt that the server refuses. */
export function connectionError(url: string): Promise<Error> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.once('error', resolve);
    socket.once('open', () => resolve(new Error('connected')));
  });
}
