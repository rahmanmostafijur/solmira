import { Global, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  HealthRegistry,
  PG_POOL,
  assertRowLevelSecurityEnforced,
  inTenantScope,
  type ScopedTransaction,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { schema, type OperationsSchema } from './schema.js';

export type OperationsDatabase = NodePgDatabase<OperationsSchema>;
export type OperationsTransaction = ScopedTransaction<OperationsSchema>;
export const OPERATIONS_DB = Symbol('OPERATIONS_DB');

/**
 * All operational data belongs to exactly one organization, so there is no "unscoped" entry
 * point here: every unit of work runs with the tenant from the verified access token.
 */
@Injectable()
export class Database implements OnModuleInit {
  constructor(
    @Inject(OPERATIONS_DB) private readonly db: OperationsDatabase,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    this.health.register('row-level-security', () => assertRowLevelSecurityEnforced(this.pool));
  }

  forTenant<T>(
    auth: TenantAuthContext,
    work: (tx: OperationsTransaction) => Promise<T>,
  ): Promise<T> {
    return inTenantScope(
      this.db,
      { organizationId: auth.organizationId, userId: auth.userId },
      work,
    );
  }
}

@Global()
@Module({
  providers: [
    {
      provide: OPERATIONS_DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    Database,
  ],
  exports: [Database],
})
export class DatabaseModule {}
