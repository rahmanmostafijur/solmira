import { Global, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import {
  HealthRegistry,
  PG_POOL,
  assertRowLevelSecurityEnforced,
  inTenantScope,
  type ScopedTransaction,
  type TenantScope,
} from '@solmira/service-kit';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { schema, type IdentitySchema } from './schema.js';

export type IdentityDatabase = NodePgDatabase<IdentitySchema>;
export type IdentityTransaction = ScopedTransaction<IdentitySchema>;
export const IDENTITY_DB = Symbol('IDENTITY_DB');

/** Entry point for all data access: every unit of work runs with an explicit tenant scope. */
@Injectable()
export class Database implements OnModuleInit {
  constructor(
    @Inject(IDENTITY_DB) readonly db: IdentityDatabase,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    // Readiness fails if the runtime role could bypass RLS, so a misconfigured instance
    // never receives traffic.
    this.health.register('row-level-security', () => assertRowLevelSecurityEnforced(this.pool));
  }

  scoped<T>(scope: TenantScope, work: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    return inTenantScope(this.db, scope, work);
  }

  /** For user-scoped data outside any organization (login, registration, token lookups). */
  unscoped<T>(work: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    return inTenantScope(this.db, { organizationId: null, userId: null }, work);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: IDENTITY_DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool) => drizzle(pool, { schema }),
    },
    Database,
  ],
  exports: [Database],
})
export class DatabaseModule {}
