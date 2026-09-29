import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import pg from 'pg';
import { HealthRegistry } from '../health/health.registry.js';

export const PG_POOL = Symbol('PG_POOL');

export interface PostgresOptions {
  readonly url: string;
  readonly poolMax: number;
  readonly applicationName: string;
}

const logger = new Logger('Postgres');

export function createPostgresPool({ url, poolMax, applicationName }: PostgresOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    application_name: applicationName,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Server-side cap so a runaway query cannot hold a connection (and its locks) indefinitely.
    statement_timeout: 15_000,
  });
  // Without a listener, an error on an idle client (e.g. the server restarting) crashes the process.
  pool.on('error', (error) => logger.error({ err: error }, 'Idle PostgreSQL client error'));
  return pool;
}

@Injectable()
class PostgresLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    this.health.register('postgres', () => this.pool.query('SELECT 1'));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({})
export class PostgresModule {
  static forRoot(options: PostgresOptions): DynamicModule {
    return {
      module: PostgresModule,
      global: true,
      providers: [
        { provide: PG_POOL, useFactory: () => createPostgresPool(options) },
        PostgresLifecycle,
      ],
      exports: [PG_POOL],
    };
  }
}
