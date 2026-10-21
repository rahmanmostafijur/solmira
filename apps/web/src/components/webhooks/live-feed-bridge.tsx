'use client';

import { REALTIME_PATH } from '@solmira/contracts';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { usePermissions } from '@/components/auth/can';
import { refreshSession, sessionStore } from '@/lib/auth/session-store';
import { DeliveryFeed, type FeedSocket } from '@/lib/realtime/delivery-feed';
import { feedStatusStore } from '@/lib/realtime/feed-status';

/** Views that change when deliveries happen: message lists and details, delivery lists, analytics. */
const LIVE_SEGMENTS = new Set(['messages', 'deliveries', 'analytics']);
const REFRESH_DEBOUNCE_MS = 400;

export function isLiveQuery(key: QueryKey, organizationId: string): boolean {
  return (
    key[0] === 'org' &&
    key[1] === organizationId &&
    key.some((part) => LIVE_SEGMENTS.has(String(part)))
  );
}

const feedUrl = () =>
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${REALTIME_PATH}`;

/**
 * Keeps one realtime feed open for the active organization (when the role may see deliveries) and
 * turns its events into a refresh of the views that show them. Renders nothing. While the feed is
 * live the views stop polling. Every time it becomes live, the first time included, they reload:
 * the feed is live only, so an event sent before this connection joined (for example a delivery
 * that finished while the page was loading) is never replayed, and the view would stay stale.
 */
export function LiveFeedBridge() {
  const queryClient = useQueryClient();
  const { organization, can } = usePermissions();
  const organizationId = organization?.id;
  const allowed = can('messages.read');

  useEffect(() => {
    if (!organizationId || !allowed) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let firstToken = true;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () =>
          void queryClient.invalidateQueries({
            predicate: (query) => isLiveQuery(query.queryKey, organizationId),
          }),
        REFRESH_DEBOUNCE_MS,
      );
    };

    const feed = new DeliveryFeed({
      createSocket: () => new WebSocket(feedUrl()) as unknown as FeedSocket,
      getToken: async () => {
        // The first connection uses the token in hand; later ones (after a drop or an expiry) a fresh one.
        if (firstToken) {
          firstToken = false;
          return sessionStore.getSnapshot().session?.accessToken ?? null;
        }
        const session = await refreshSession();
        sessionStore.set(session);
        return session?.accessToken ?? null;
      },
      onEvent: refresh,
      onStatus: (status) => {
        feedStatusStore.set(status);
        if (status === 'live') refresh();
      },
    });
    feed.start();
    return () => {
      clearTimeout(refreshTimer);
      feed.stop();
    };
  }, [organizationId, allowed, queryClient]);

  return null;
}
