import path from 'node:path';
import { PERMISSION_CATALOG, ROLE_DEFINITIONS, ROLE_KEYS } from '@solmira/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

/**
 * Applies migrations and syncs the access catalog. Must run as the schema owner role, never as
 * the runtime role: the owner creates tables (so default privileges grant the runtime role DML)
 * and is the only role allowed to write the catalog tables.
 */
export async function migrateDatabase(ownerDatabaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerDatabaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    await syncAccessCatalog(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Makes the permissions, system roles and role→permission mapping in the database match the
 * catalog in @solmira/contracts. Idempotent; runs on every deploy.
 */
export async function syncAccessCatalog(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const permissionKeys = Object.keys(PERMISSION_CATALOG);
    for (const [key, description] of Object.entries(PERMISSION_CATALOG)) {
      await client.query(
        `insert into permissions (key, description) values ($1, $2)
         on conflict (key) do update set description = excluded.description`,
        [key, description],
      );
    }
    await client.query('delete from permissions where not (key = any($1::text[]))', [
      permissionKeys,
    ]);

    for (const roleKey of ROLE_KEYS) {
      const role = ROLE_DEFINITIONS[roleKey];
      const { rows } = await client.query<{ id: string }>(
        `insert into roles (id, key, name, description, rank, organization_id)
         values ($1, $2, $3, $4, $5, null)
         on conflict (key) where organization_id is null
         do update set name = excluded.name, description = excluded.description, rank = excluded.rank
         returning id`,
        [uuidv7(), role.key, role.name, role.description, role.rank],
      );
      const roleId = rows[0]!.id;
      await client.query('delete from role_permissions where role_id = $1', [roleId]);
      await client.query(
        `insert into role_permissions (role_id, permission_key)
         select $1, unnest($2::text[])`,
        [roleId, role.permissions],
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
