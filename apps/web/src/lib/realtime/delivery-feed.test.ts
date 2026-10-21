import { describe, expect, it, vi } from 'vitest';
import { DeliveryFeed, reconnectDelayMs, type FeedSocket, type FeedStatus } from './delivery-feed';

class FakeSocket implements FeedSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

function setup(token: string | null = 'tok-1') {
  const sockets: FakeSocket[] = [];
  const statuses: FeedStatus[] = [];
  const events: unknown[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const getToken = vi.fn(async () => token);
  const feed = new DeliveryFeed({
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    getToken,
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
    setTimer: (callback, ms) => timers.push({ callback, ms }),
    clearTimer: () => undefined,
  });
  return { feed, sockets, statuses, events, timers, getToken };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ready = JSON.stringify({ type: 'ready', organizationId: 'o' });

describe('DeliveryFeed', () => {
  it('authenticates with the token in the first frame and reports live once ready', async () => {
    const { feed, sockets, statuses } = setup();
    feed.start();
    await tick();
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.({ data: ready });

    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'auth', token: 'tok-1' });
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('passes events on and ignores unreadable frames', async () => {
    const { feed, sockets, events } = setup();
    const event = { type: 'message.created', data: { messageId: 'm' } };
    feed.start();
    await tick();
    sockets[0]!.onmessage?.({ data: 'not json' });
    sockets[0]!.onmessage?.({ data: new ArrayBuffer(1) });
    sockets[0]!.onmessage?.({ data: JSON.stringify(event) });

    expect(events).toEqual([event]);
  });

  it('reconnects with backoff and a fresh token after the connection drops', async () => {
    const { feed, sockets, statuses, timers, getToken } = setup();
    feed.start();
    await tick();
    sockets[0]!.onclose?.({ code: 4401 });

    expect(statuses.at(-1)).toBe('offline');
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBeGreaterThanOrEqual(500);
    timers[0]!.callback();
    await tick();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });

  it('does not reconnect after a refusal for missing permission', async () => {
    const { feed, sockets, timers } = setup();
    feed.start();
    await tick();
    sockets[0]!.onclose?.({ code: 4403 });
    expect(timers).toHaveLength(0);
  });

  it('waits for a token when signed out and never connects without one', async () => {
    const { feed, sockets, timers } = setup(null);
    feed.start();
    await tick();
    expect(sockets).toHaveLength(0);
    expect(timers).toHaveLength(1);
  });

  it('stops for good: closes the socket and schedules nothing', async () => {
    const { feed, sockets, timers } = setup();
    feed.start();
    await tick();
    feed.stop();
    sockets[0]!.onclose?.({ code: 1006 });

    expect(sockets[0]!.closed).toBe(true);
    expect(timers).toHaveLength(0);
  });
});

describe('reconnectDelayMs', () => {
  it('grows with each attempt up to a ceiling and stays jittered', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(500);
    expect(reconnectDelayMs(0, () => 1)).toBe(1_000);
    expect(reconnectDelayMs(3, () => 1)).toBe(8_000);
    expect(reconnectDelayMs(20, () => 1)).toBe(30_000);
  });
});
