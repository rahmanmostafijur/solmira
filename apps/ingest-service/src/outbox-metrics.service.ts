import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { MetricsRegistry, PG_POOL } from '@solmira/service-kit';
import type pg from 'pg';

/**
 * Reports how many events wait in the outbox and how long the oldest has waited. The relay should
 * keep this near zero; a growing age means events are not reaching the broker (ADR-0039).
 */
@Injectable()
export class OutboxMetrics implements OnApplicationBootstrap {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(MetricsRegistry) private readonly metrics: MetricsRegistry,
  ) {}

  onApplicationBootstrap(): void {
    this.metrics.collect(async () => {
      const { rows } = await this.pool.query<{ unpublished: number; oldest: number }>(
        `select count(*)::int as unpublished,
                coalesce(extract(epoch from now() - min(occurred_at)), 0)::float8 as oldest
           from outbox_events where published_at is null`,
      );
      this.metrics.gauge('OutboxUnpublished', rows[0]?.unpublished ?? 0);
      this.metrics.gauge('OutboxOldestAge', rows[0]?.oldest ?? 0, 'Seconds');
    });
  }
}
