import type { RealtimeEvent } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { RealtimeHub, type FeedConnection } from './realtime.hub.js';

class FakeConnection implements FeedConnection {
  readonly received: string[] = [];
  closed: { code: number; reason: string } | undefined;
  buffered = 0;
  send(frame: string): void {
    this.received.push(frame);
  }
  bufferedBytes(): number {
    return this.buffered;
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
}

const event = (messageId: string): RealtimeEvent => ({
  type: 'message.created',
  occurredAt: '2026-10-21T10:00:00.000Z',
  data: { messageId, applicationId: 'a1' },
});

const hub = () => new RealtimeHub({ maxPerOrganization: 2, maxBufferedBytes: 1000 });

describe('RealtimeHub', () => {
  it('delivers an event only to the connections of its own organization', () => {
    const h = hub();
    const a1 = new FakeConnection();
    const a2 = new FakeConnection();
    const b = new FakeConnection();
    h.add('org-a', a1);
    h.add('org-a', a2);
    h.add('org-b', b);

    expect(h.broadcast('org-a', event('m-1'))).toBe(2);

    expect(a1.received).toHaveLength(1);
    expect(a2.received).toHaveLength(1);
    expect(b.received).toEqual([]);
    expect(JSON.parse(a1.received[0]!).data.messageId).toBe('m-1');
  });

  it('delivers to nobody when the organization has no connection', () => {
    expect(hub().broadcast('org-none', event('m-1'))).toBe(0);
  });

  it('stops sending to a connection that was removed', () => {
    const h = hub();
    const c = new FakeConnection();
    h.add('org-a', c);
    h.remove('org-a', c);
    h.broadcast('org-a', event('m-1'));
    expect(c.received).toEqual([]);
    expect(h.connectionCount).toBe(0);
  });

  it('refuses connections beyond the limit of one organization, not of another', () => {
    const h = hub();
    expect(h.add('org-a', new FakeConnection())).toBe(true);
    expect(h.add('org-a', new FakeConnection())).toBe(true);
    expect(h.add('org-a', new FakeConnection())).toBe(false);
    expect(h.add('org-b', new FakeConnection())).toBe(true);
  });

  it('drops a client that falls too far behind and keeps serving the others', () => {
    const h = hub();
    const slow = new FakeConnection();
    const fast = new FakeConnection();
    h.add('org-a', slow);
    h.add('org-a', fast);
    slow.buffered = 5000;

    expect(h.broadcast('org-a', event('m-1'))).toBe(1);

    expect(slow.received).toEqual([]);
    expect(slow.closed?.code).toBe(1013);
    expect(fast.received).toHaveLength(1);
    expect(h.connectionCount).toBe(1);
  });

  it('closes every connection on shutdown', () => {
    const h = hub();
    const c = new FakeConnection();
    h.add('org-a', c);
    h.closeAll(1001, 'restart');
    expect(c.closed).toEqual({ code: 1001, reason: 'restart' });
    expect(h.connectionCount).toBe(0);
  });
});
