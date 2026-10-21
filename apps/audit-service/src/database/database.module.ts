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
import { schema, type AuditSchema } from './schema.js';

export type AuditDatabase = NodePgDatabase<AuditSchema>;
export type AuditTransaction = ScopedTransaction<AuditSchema>;
export const AUDIT_DB = Symbol('AUDIT_DB');

/** Whose data a unit of work may touch: a signed-in user, or the event being processed. */
export interface TenantContext {
  readonly organizationId: string;
  readonly userId: string | null;
}

/** Every unit of work runs inside one organization; there is no unscoped entry point. */
@Injectable()
export class Database implements OnModuleInit {
  constructor(
    @Inject(AUDIT_DB) private readonly db: AuditDatabase,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    this.health.register('row-level-security', () => assertRowLevelSecurityEnforced(this.pool));
  }

  forTenant<T>(scope: TenantContext, work: (tx: AuditTransaction) => Promise<T>): Promise<T> {
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
      provide: AUDIT_DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    Database,
  ],
  exports: [Database],
})
export class DatabaseModule {}
