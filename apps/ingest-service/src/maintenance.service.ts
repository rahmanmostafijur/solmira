import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PG_POOL } from '@solmira/service-kit';
import type pg from 'pg';
import type { IngestConfig } from './config.js';
import { INGEST_CONFIG } from './ingest.tokens.js';

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 5_000;

/**
 * Hourly housekeeping: expired idempotency records and published outbox rows older than the
 * retention period are removed in bounded batches. Failures are logged and retried next hour;
 * nothing depends on this job for correctness, only for table size.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Maintenance');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass; returns how many rows each cleanup removed. Also used by tests. */
  async runOnce(): Promise<{ idempotencyKeys: number; outboxEvents: number }> {
    try {
      const keys = await this.pool.query<{ purged: number }>(
        'select purge_expired_idempotency_keys($1) as purged',
        [BATCH_SIZE],
      );
      const outbox = await this.pool.query(
        `delete from outbox_events
          where id in (
            select id from outbox_events
             where published_at < now() - make_interval(days => $1)
             limit $2)`,
        [this.config.OUTBOX_RETENTION_DAYS, BATCH_SIZE],
      );
      return { idempotencyKeys: keys.rows[0]?.purged ?? 0, outboxEvents: outbox.rowCount ?? 0 };
    } catch (error) {
      this.logger.warn({ err: error }, 'Maintenance pass failed');
      throw error;
    }
  }
}
