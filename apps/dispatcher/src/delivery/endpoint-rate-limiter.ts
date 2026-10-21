import { Logger } from '@nestjs/common';
import { AttemptCounter, type Redis } from '@solmira/service-kit';

export interface RateDecision {
  readonly allowed: boolean;
  /** When refused: how long until the window resets. */
  readonly retryAfterMs: number;
}

const WINDOW_SECONDS = 1;

/**
 * Per-endpoint rate limit in Redis, a fixed one second window (ADR-0033). Without Redis, or when
 * Redis fails, deliveries go through: a cache outage must not stop delivery (it is logged).
 */
export class EndpointRateLimiter {
  private readonly logger = new Logger('EndpointRateLimiter');
  private readonly counter: AttemptCounter | undefined;

  constructor(redis: Redis | undefined) {
    this.counter = redis
      ? new AttemptCounter(redis, 'dispatch:endpoint-rate', WINDOW_SECONDS)
      : undefined;
  }

  async tryAcquire(endpointId: string, limitPerSecond: number | null): Promise<RateDecision> {
    if (!this.counter || limitPerSecond === null) return { allowed: true, retryAfterMs: 0 };
    try {
      const used = await this.counter.record(endpointId);
      if (used <= limitPerSecond) return { allowed: true, retryAfterMs: 0 };
      const { retryAfterSeconds } = await this.counter.status(endpointId);
      return { allowed: false, retryAfterMs: Math.max(retryAfterSeconds, 1) * 1000 };
    } catch (error) {
      this.logger.warn({ err: error }, 'Rate limiter unavailable; sending without a limit');
      return { allowed: true, retryAfterMs: 0 };
    }
  }
}
