import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { AttemptCounter } from '../src/rate-limit/attempt-counter.js';

const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6379');

describe('AttemptCounter against real Redis', () => {
  afterAll(async () => {
    await redis.quit();
  });

  it('counts attempts within a window and reports when it resets', async () => {
    const counter = new AttemptCounter(redis, `test:${randomUUID()}`, 60);

    await counter.record('user@example.test');
    await counter.record('user@example.test');
    const status = await counter.status('user@example.test');

    expect(status.attempts).toBe(2);
    expect(status.retryAfterSeconds).toBeGreaterThan(55);
  });

  it('does not extend the window on later attempts', async () => {
    const counter = new AttemptCounter(redis, `test:${randomUUID()}`, 2);
    await counter.record('k');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await counter.record('k');

    expect((await counter.status('k')).retryAfterSeconds).toBeLessThanOrEqual(1);
  });

  it('resets on demand', async () => {
    const counter = new AttemptCounter(redis, `test:${randomUUID()}`, 60);
    await counter.record('k');
    await counter.reset('k');

    expect((await counter.status('k')).attempts).toBe(0);
  });
});
