import { Global, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  HealthRegistry,
  PG_POOL,
  assertRowLevelSecurityEnforced,
  inTenantScope,
  type ScopedTransaction,
} from '@solmira/service-kit';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { schema, type IngestSchema } from './schema.js';

export type IngestDatabase = NodePgDatabase<IngestSchema>;
export type IngestTransaction = ScopedTransaction<IngestSchema>;

/** Whose data a unit of work may touch: a signed-in user, an API key (no user) or a consumer. */
export interface TenantContext {
  readonly organizationId: string;
  readonly userId: string | null;
}

export const INGEST_DB = Symbol('INGEST_DB');

/**
 * All data belongs to exactly one organization, so there is no "unscoped" entry point here:
 * every unit of work runs with a tenant taken from the verified token, the API key's own record,
 * or the event being processed.
 */
@Injectable()
export class Database implements OnModuleInit {
  constructor(
    @Inject(INGEST_DB) private readonly db: IngestDatabase,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    this.health.register('row-level-security', () => assertRowLevelSecurityEnforced(this.pool));
  }

  forTenant<T>(scope: TenantContext, work: (tx: IngestTransaction) => Promise<T>): Promise<T> {
    return inTenantScope(
      this.db,
      { organizationId: scope.organizationId, userId: scope.userId },
      work,
    );
  }
}

@Global()
@Module({
  providers: [
    {
      provide: INGEST_DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    Database,
  ],
  exports: [Database],
})
export class DatabaseModule {}
