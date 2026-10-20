import { Inject, Injectable, Logger } from '@nestjs/common';
import { AttemptCounter, RateLimitedError, REDIS, type Redis } from '@solmira/service-kit';
import type { IngestConfig } from '../config.js';
import { INGEST_CONFIG } from '../ingest.tokens.js';

const WINDOW_SECONDS = 60;

/**
 * A fixed window per API key in Redis. Over the limit the request is refused with `Retry-After`.
 * If Redis is unreachable the limiter lets the request through (and logs it): refusing every
 * tenant because a cache is down would be a worse outage than briefly not limiting (ADR-0030).
 */
@Injectable()
export class ApiKeyRateLimiter {
  private readonly logger = new Logger('ApiKeyRateLimiter');
  private readonly counter: AttemptCounter;

  constructor(
    @Inject(REDIS) redis: Redis,
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
  ) {
    this.counter = new AttemptCounter(redis, 'ingest:ratelimit', WINDOW_SECONDS);
  }

  async consume(apiKeyId: string): Promise<void> {
    let attempts: number;
    try {
      attempts = await this.counter.record(apiKeyId);
    } catch (error) {
      this.logger.warn({ err: error }, 'Rate limiter unavailable; allowing the request');
      return;
    }
    if (attempts <= this.config.INGEST_RATE_LIMIT_PER_MINUTE) return;
    const { retryAfterSeconds } = await this.counter.status(apiKeyId).catch(() => ({
      retryAfterSeconds: WINDOW_SECONDS,
    }));
    throw new RateLimitedError(Math.max(retryAfterSeconds, 1), 'API key rate limit exceeded');
  }
}
