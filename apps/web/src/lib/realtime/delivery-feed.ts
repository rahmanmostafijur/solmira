import { REALTIME_CLOSE, type RealtimeServerFrame } from '@solmira/contracts';

export type FeedStatus = 'connecting' | 'live' | 'offline';

/** The part of a WebSocket the feed uses, so tests can supply a fake. */
export interface FeedSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface DeliveryFeedOptions {
  readonly createSocket: () => FeedSocket;
  /** A current access token, refreshed if needed; null when the user is signed out. */
  readonly getToken: () => Promise<string | null>;
  readonly onEvent: (event: Exclude<RealtimeServerFrame, { type: 'ready' }>) => void;
  readonly onStatus: (status: FeedStatus) => void;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** Exponential backoff with jitter, so many clients do not reconnect in step. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * A connection to the realtime delivery feed that keeps itself alive: it authenticates with the
 * user's access token in the first frame, reports whether it is live, and reconnects with backoff
 * (with a fresh token) when the connection drops or its token expires. The feed is live only, so
 * the owner reloads its data after every reconnect and polls while the feed is not live.
 */
export class DeliveryFeed {
  private socket: FeedSocket | undefined;
  private attempt = 0;
  private stopped = false;
  private timer: unknown;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: DeliveryFeedOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer(this.timer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
    this.options.onStatus('offline');
  }

  private async connect(): Promise<void> {
    this.options.onStatus('connecting');
    const token = await this.options.getToken();
    if (this.stopped) return;
    if (!token) return this.scheduleReconnect();

    const socket = this.options.createSocket();
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token }));
    socket.onmessage = (message) => this.receive(message.data);
    socket.onclose = (event) => {
      this.socket = undefined;
      this.options.onStatus('offline');
      // A role without access does not gain it by retrying; the next sign-in starts a new feed.
      if (event.code === REALTIME_CLOSE.forbidden) return;
      this.scheduleReconnect();
    };
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let frame: RealtimeServerFrame;
    try {
      frame = JSON.parse(data) as RealtimeServerFrame;
    } catch {
      return;
    }
    if (frame.type === 'ready') {
      this.attempt = 0;
      this.options.onStatus('live');
      return;
    }
    this.options.onEvent(frame);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.timer = this.setTimer(() => void this.connect(), delay);
  }
}
