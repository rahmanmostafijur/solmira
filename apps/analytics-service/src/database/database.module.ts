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
import { schema, type AnalyticsSchema } from './schema.js';

export type AnalyticsDatabase = NodePgDatabase<AnalyticsSchema>;
export type AnalyticsTransaction = ScopedTransaction<AnalyticsSchema>;
export const ANALYTICS_DB = Symbol('ANALYTICS_DB');

/** Whose data a unit of work may touch: a signed-in user, or the event being processed. */
export interface TenantContext {
  readonly organizationId: string;
  readonly userId: string | null;
}

/** Every unit of work runs inside one organization; there is no unscoped entry point. */
@Injectable()
export class Database implements OnModuleInit {
  constructor(
    @Inject(ANALYTICS_DB) private readonly db: AnalyticsDatabase,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    this.health.register('row-level-security', () => assertRowLevelSecurityEnforced(this.pool));
  }

  forTenant<T>(scope: TenantContext, work: (tx: AnalyticsTransaction) => Promise<T>): Promise<T> {
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
      provide: ANALYTICS_DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    Database,
  ],
  exports: [Database],
})
export class DatabaseModule {}
