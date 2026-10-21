import { describe, expect, it } from 'vitest';
import { isLiveQuery } from './live-feed-bridge';

describe('isLiveQuery', () => {
  it('refreshes message, delivery and analytics views of the active organization', () => {
    expect(isLiveQuery(['org', 'o1', 'applications', 'a', 'messages', {}], 'o1')).toBe(true);
    expect(
      isLiveQuery(['org', 'o1', 'applications', 'a', 'endpoints', 'e', 'deliveries'], 'o1'),
    ).toBe(true);
    expect(isLiveQuery(['org', 'o1', 'applications', 'a', 'analytics', { hours: 24 }], 'o1')).toBe(
      true,
    );
  });

  it('leaves configuration views and other organizations alone', () => {
    expect(isLiveQuery(['org', 'o1', 'applications', 'a', 'api-keys'], 'o1')).toBe(false);
    expect(isLiveQuery(['org', 'o1', 'event-types'], 'o1')).toBe(false);
    expect(isLiveQuery(['org', 'o2', 'applications', 'a', 'messages'], 'o1')).toBe(false);
    expect(isLiveQuery(['me'], 'o1')).toBe(false);
  });
});
