import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PG_POOL } from '@solmira/service-kit';
import type pg from 'pg';
import { ANALYTICS_CONFIG } from '../analytics.tokens.js';
import type { AnalyticsConfig } from '../config.js';

const INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 5_000;

/** Hourly: removes attempts older than the retention period, in bounded batches. */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Maintenance');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(ANALYTICS_CONFIG) private readonly config: AnalyticsConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One pass; returns how many attempts were removed. Also used by tests. */
  async runOnce(): Promise<number> {
    try {
      const { rows } = await this.pool.query<{ purged: number }>(
        'select purge_old_delivery_attempts($1, $2) as purged',
        [this.config.ANALYTICS_RETENTION_DAYS, BATCH_SIZE],
      );
      return rows[0]?.purged ?? 0;
    } catch (error) {
      this.logger.warn({ err: error }, 'Maintenance pass failed');
      throw error;
    }
  }
}
