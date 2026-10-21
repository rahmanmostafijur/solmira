import { describe, expect, it } from 'vitest';
import { describeAttempt, summarizeDeliveries } from './delivery-status';

describe('describeAttempt', () => {
  it('describes success, failures with a status and failures without one', () => {
    expect(describeAttempt(200, null)).toBe('Delivered (HTTP 200)');
    expect(describeAttempt(503, 'http_5xx')).toBe('Receiver error (HTTP 503)');
    expect(describeAttempt(null, 'timeout')).toBe('Timed out');
    expect(describeAttempt(null, 'something_new')).toBe('something_new');
  });
});

describe('summarizeDeliveries', () => {
  it('lists only the statuses that occur', () => {
    expect(summarizeDeliveries({ pending: 0, in_progress: 0, succeeded: 2, failed: 1 })).toBe(
      '2 delivered, 1 failed',
    );
    expect(summarizeDeliveries({ pending: 0, in_progress: 0, succeeded: 0, failed: 0 })).toBe(
      'No deliveries',
    );
  });
});
