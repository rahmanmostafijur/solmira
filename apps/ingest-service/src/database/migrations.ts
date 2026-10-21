import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

/** The database role the dispatcher connects as (ADR-0031). */
export const DEFAULT_DISPATCHER_ROLE = 'dispatcher_app';

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export interface MigrateOptions {
  /** The dispatcher's role; it is granted its narrow access only if the role exists. */
  readonly dispatcherRole?: string;
}

/**
 * Applies migrations, then grants the dispatcher exactly the access it needs. Runs as the schema
 * owner role, never as the runtime role.
 */
export async function migrateDatabase(
  ownerDatabaseUrl: string,
  options: MigrateOptions = {},
): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerDatabaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    await grantDispatcherAccess(pool, options.dispatcherRole ?? DEFAULT_DISPATCHER_ROLE);
  } finally {
    await pool.end();
  }
}

/**
 * The dispatcher reads what it needs to send (messages, endpoints, secrets), updates deliveries and
 * the health columns of endpoints, and records the event for an endpoint it disables. Row Level Security applies to it: after claiming through claim_due_deliveries() it
 * works inside the tenant of each delivery. It gets no access to API keys, applications,
 * idempotency records or the outbox (it may only add events), and sees only the name of event types. Idempotent; does nothing if the role does not exist.
 */
export async function grantDispatcherAccess(pool: pg.Pool, role: string): Promise<void> {
  if (!ROLE_NAME.test(role)) throw new Error('Unsafe role name: ' + role);
  const { rowCount } = await pool.query('select 1 from pg_roles where rolname = $1', [role]);
  if (!rowCount) return;
  for (const statement of [
    'grant usage on schema public to ' + role,
    'grant select on messages, endpoints, endpoint_secrets to ' + role,
    'grant select, update on deliveries to ' + role,
    // Health and automatic disabling of endpoints (ADR-0033); nothing else on endpoints may change.
    'grant update (consecutive_failures, first_failure_at, circuit_open_until, circuit_trips, enabled, ' +
      'disabled_reason, disabled_at, updated_at) on endpoints to ' +
      role,
    // The event that tells the tenant an endpoint was disabled; the relay publishes it.
    // The event type's name travels in delivery.attempted; its schema and description do not.
    'grant select (id, organization_id, name) on event_types to ' + role,
    'grant insert on outbox_events to ' + role,
    'grant execute on function claim_due_deliveries(integer, integer, integer, integer) to ' + role,
    'grant execute on function app_current_organization_id() to ' + role,
  ])
    await pool.query(statement);
}
