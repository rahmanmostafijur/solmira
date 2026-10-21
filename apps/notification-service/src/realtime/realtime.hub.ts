import { REALTIME_CLOSE, type RealtimeEvent } from '@solmira/contracts';

/** What the hub needs from a client connection; the WebSocket gateway adapts `ws` to it. */
export interface FeedConnection {
  send(frame: string): void;
  /** Bytes queued for this client and not yet written to the network. */
  bufferedBytes(): number;
  close(code: number, reason: string): void;
}

export interface HubLimits {
  readonly maxPerOrganization: number;
  /** A client that falls this far behind is dropped rather than buffered without bound. */
  readonly maxBufferedBytes: number;
}

/**
 * The tenant boundary of the realtime feed: connections are registered under the organization of
 * their verified token, and an event is only ever written to the connections of the organization
 * it belongs to. Nothing else in the feed decides who sees what.
 */
export class RealtimeHub {
  private readonly byOrganization = new Map<string, Set<FeedConnection>>();

  constructor(private readonly limits: HubLimits) {}

  get connectionCount(): number {
    let total = 0;
    for (const set of this.byOrganization.values()) total += set.size;
    return total;
  }

  /** False when the organization already has its maximum number of open connections. */
  add(organizationId: string, connection: FeedConnection): boolean {
    const set = this.byOrganization.get(organizationId) ?? new Set<FeedConnection>();
    if (set.size >= this.limits.maxPerOrganization) return false;
    set.add(connection);
    this.byOrganization.set(organizationId, set);
    return true;
  }

  remove(organizationId: string, connection: FeedConnection): void {
    const set = this.byOrganization.get(organizationId);
    if (!set) return;
    set.delete(connection);
    if (set.size === 0) this.byOrganization.delete(organizationId);
  }

  /** Sends the event to every connection of the organization; returns how many received it. */
  broadcast(organizationId: string, event: RealtimeEvent): number {
    const set = this.byOrganization.get(organizationId);
    if (!set) return 0;
    const frame = JSON.stringify(event);
    let delivered = 0;
    for (const connection of [...set]) {
      if (connection.bufferedBytes() > this.limits.maxBufferedBytes) {
        this.remove(organizationId, connection);
        connection.close(REALTIME_CLOSE.tooSlow, 'Too slow; reconnect and reload');
        continue;
      }
      connection.send(frame);
      delivered += 1;
    }
    return delivered;
  }

  closeAll(code: number, reason: string): void {
    for (const set of this.byOrganization.values())
      for (const connection of set) connection.close(code, reason);
    this.byOrganization.clear();
  }
}
