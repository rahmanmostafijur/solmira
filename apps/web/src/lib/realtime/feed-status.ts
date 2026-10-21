import { useSyncExternalStore } from 'react';
import type { FeedStatus } from './delivery-feed';

let status: FeedStatus = 'offline';
const listeners = new Set<() => void>();

/** Whether the realtime feed is connected; views poll only while it is not. */
export const feedStatusStore = {
  get: (): FeedStatus => status,
  set(next: FeedStatus): void {
    if (next === status) return;
    status = next;
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const useFeedStatus = (): FeedStatus =>
  useSyncExternalStore(feedStatusStore.subscribe, feedStatusStore.get, () => 'offline');
