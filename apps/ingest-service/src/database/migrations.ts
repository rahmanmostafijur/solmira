import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

/** Applies migrations. Runs as the schema owner role, never as the runtime role. */
export async function migrateDatabase(ownerDatabaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerDatabaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
