import type { Redis } from 'ioredis';

export interface AttemptStatus {
  readonly attempts: number;
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window counter in Redis for throttling sensitive actions (failed logins, reset requests).
 * The window starts at the first attempt and is not extended by later ones, so an attacker cannot
 * keep a victim locked out indefinitely by continuing to fail.
 */
export class AttemptCounter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly windowSeconds: number,
  ) {}

  async status(key: string): Promise<AttemptStatus> {
    const redisKey = this.key(key);
    const [count, ttl] = await Promise.all([this.redis.get(redisKey), this.redis.ttl(redisKey)]);
    return { attempts: Number(count ?? 0), retryAfterSeconds: Math.max(ttl, 0) };
  }

  async record(key: string): Promise<number> {
    const redisKey = this.key(key);
    const results = await this.redis
      .multi()
      .incr(redisKey)
      .expire(redisKey, this.windowSeconds, 'NX')
      .exec();
    return Number(results?.[0]?.[1] ?? 0);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  private key(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
