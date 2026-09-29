import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * The trusted tenant context for one unit of work. It is always derived from the verified access
 * token (or, for background work, from the event being processed), never from request input.
 */
export interface TenantScope {
  readonly organizationId: string | null;
  readonly userId: string | null;
}

export type ScopedTransaction<TSchema extends Record<string, unknown>> = Parameters<
  Parameters<NodePgDatabase<TSchema>['transaction']>[0]
>[0];

/**
 * Runs `work` in a transaction whose PostgreSQL session settings carry the tenant context.
 * Row Level Security policies read `app.organization_id` / `app.user_id`, so every query inside
 * is filtered by the database even if application code forgets a WHERE clause.
 *
 * `set_config(..., true)` is transaction-local: the setting disappears on COMMIT/ROLLBACK, so a
 * pooled connection can never leak one tenant's context into the next request.
 */
export async function inTenantScope<TSchema extends Record<string, unknown>, T>(
  db: NodePgDatabase<TSchema>,
  scope: TenantScope,
  work: (tx: ScopedTransaction<TSchema>) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.organization_id', ${scope.organizationId ?? ''}, true),
                 set_config('app.user_id', ${scope.userId ?? ''}, true)`,
    );
    return work(tx);
  });
}
