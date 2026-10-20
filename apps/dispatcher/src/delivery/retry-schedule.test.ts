import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_SCHEDULE } from '../config.js';
import { maxAttempts, nextAttempt, type RetryPolicy } from './retry-schedule.js';

const defaults: RetryPolicy = {
  schedule: DEFAULT_RETRY_SCHEDULE.split(',').map(Number),
  jitterRatio: 0.2,
};
const NOW = new Date('2026-10-21T12:00:00.000Z');
const SECOND = 1000;

describe('the default retry schedule', () => {
  it('is immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h: eight attempts', () => {
    expect(defaults.schedule).toEqual([0, 5, 300, 1800, 7200, 18000, 36000, 36000]);
    expect(maxAttempts(defaults)).toBe(8);
  });

  it('waits the scheduled time after each failed attempt, with no jitter at the midpoint', () => {
    const middle = () => 0.5;
    const waits = [1, 2, 3, 4, 5, 6, 7].map((attempt) => {
      const next = nextAttempt(defaults, attempt, NOW, middle);
      if (next.exhausted) throw new Error('exhausted too early');
      return next.delayMs / SECOND;
    });
    expect(waits).toEqual([5, 300, 1800, 7200, 18000, 36000, 36000]);
  });

  it('marks the delivery exhausted after the eighth failed attempt', () => {
    expect(nextAttempt(defaults, 8, NOW).exhausted).toBe(true);
    expect(nextAttempt(defaults, 100, NOW).exhausted).toBe(true);
    expect(nextAttempt(defaults, 7, NOW).exhausted).toBe(false);
  });
});

describe('jitter', () => {
  it('stays within the configured ratio of the scheduled wait', () => {
    for (const [attempt, seconds] of [
      [1, 5],
      [3, 1800],
      [6, 36000],
    ] as const) {
      const low = nextAttempt(defaults, attempt, NOW, () => 0);
      const high = nextAttempt(defaults, attempt, NOW, () => 0.999999999);
      if (low.exhausted || high.exhausted) throw new Error('unexpected');
      expect(low.delayMs).toBe(Math.round(seconds * SECOND * 0.8));
      expect(high.delayMs).toBeLessThanOrEqual(Math.round(seconds * SECOND * 1.2));
      expect(high.delayMs).toBeGreaterThan(seconds * SECOND * 1.19);
    }
  });

  it('never moves outside the bounds for any random value', () => {
    for (let i = 0; i < 2_000; i += 1) {
      const next = nextAttempt(defaults, 4, NOW);
      if (next.exhausted) throw new Error('unexpected');
      expect(next.delayMs).toBeGreaterThanOrEqual(7200 * SECOND * 0.8);
      expect(next.delayMs).toBeLessThanOrEqual(7200 * SECOND * 1.2);
    }
  });

  it('really spreads the retries instead of repeating one value', () => {
    const delays = new Set(
      Array.from({ length: 50 }, () => {
        const next = nextAttempt(defaults, 3, NOW);
        return next.exhausted ? -1 : next.delayMs;
      }),
    );
    expect(delays.size).toBeGreaterThan(40);
  });

  it('leaves a zero wait at zero and honours a zero ratio', () => {
    const immediate = nextAttempt({ schedule: [0, 0, 60], jitterRatio: 0.2 }, 1, NOW);
    expect(immediate).toMatchObject({ exhausted: false, delayMs: 0 });
    const exact = nextAttempt({ schedule: [0, 60], jitterRatio: 0 }, 1, NOW, Math.random);
    expect(exact).toMatchObject({ exhausted: false, delayMs: 60_000 });
  });

  it('computes the retry time from the clock it is given', () => {
    const next = nextAttempt(defaults, 2, NOW, () => 0.5);
    if (next.exhausted) throw new Error('unexpected');
    expect(next.at.toISOString()).toBe('2026-10-21T12:05:00.000Z');
  });
});
