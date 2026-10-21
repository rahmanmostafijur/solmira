// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionStore } from '@/lib/auth/session-store';
import { LiveFeedBridge } from './live-feed-bridge';

vi.mock('@/components/auth/can', () => ({
  usePermissions: () => ({ organization: { id: 'o1' }, can: () => true }),
}));

class FakeSocket {
  static last: FakeSocket | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly sent: string[] = [];
  constructor() {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  ready() {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
  }
}

const MESSAGES_KEY = ['org', 'o1', 'applications', 'a1', 'messages', {}];

describe('LiveFeedBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    sessionStore.set({ accessToken: 'token' } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStore.set(null);
  });

  // Regression: a delivery that finished while the page loaded (before this connection joined the
  // feed) was never shown, because only a reconnect, not the first connection, reloaded the views.
  it('reloads the delivery views when the feed first becomes live', async () => {
    const client = new QueryClient();
    client.setQueryData(MESSAGES_KEY, { items: [] });
    render(
      <QueryClientProvider client={client}>
        <LiveFeedBridge />
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(client.getQueryState(MESSAGES_KEY)?.isInvalidated).toBe(false);

    await act(async () => {
      FakeSocket.last?.ready();
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(FakeSocket.last?.sent[0]).toContain('"auth"');
    expect(client.getQueryState(MESSAGES_KEY)?.isInvalidated).toBe(true);
  });
});
