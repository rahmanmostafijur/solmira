import { RateLimitedError, type Redis } from '@solmira/service-kit';
import { describe, expect, it } from 'vitest';
import type { IngestConfig } from '../config.js';
import { ApiKeyRateLimiter } from './api-key-rate-limiter.js';

const config = { INGEST_RATE_LIMIT_PER_MINUTE: 2 } as IngestConfig;

/** Just enough of ioredis for AttemptCounter: counts per key, with a fixed TTL. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const chain = {
    incr(key: string) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      this.last = key;
      return this;
    },
    expire() {
      return this;
    },
    last: '',
    async exec() {
      return [[null, counts.get(this.last)]];
    },
  };
  return {
    multi: () => chain,
    get: async (key: string) => String(counts.get(key) ?? 0),
    ttl: async () => 42,
  } as unknown as Redis;
}

describe('ApiKeyRateLimiter', () => {
  it('lets requests through up to the limit, then refuses with the remaining window', async () => {
    const limiter = new ApiKeyRateLimiter(fakeRedis(), config);
    await limiter.consume('key-a');
    await limiter.consume('key-a');
    const refusal = await limiter.consume('key-a').catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RateLimitedError);
    expect((refusal as RateLimitedError).retryAfterSeconds).toBe(42);
    await limiter.consume('key-b');
  });

  it('allows the request when Redis is unavailable instead of refusing every tenant', async () => {
    const broken = {
      multi: () => {
        throw new Error('Redis is down');
      },
    } as unknown as Redis;
    await expect(new ApiKeyRateLimiter(broken, config).consume('key-a')).resolves.toBeUndefined();
  });
});
