import pg from 'pg';
import { migrateDatabase } from '../../src/database/migrations.js';

/**
 * Builds a throwaway identity database that mirrors production privileges: an owner role that
 * runs migrations and a separate runtime role that is subject to Row Level Security. Tests then
 * run the application as the runtime role, exactly as deployed.
 */
export const TEST_DATABASE = 'solmira_identity_test';
const OWNER = 'identity_test_owner';
const APP = 'identity_test_app';
const PASSWORD = 'identity_test_password';

export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://solmira:solmira_dev_password@localhost:5433/postgres';

function urlFor(user: string, database: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.username = user;
  url.password = PASSWORD;
  url.pathname = `/${database}`;
  return url.toString();
}

export interface TestDatabaseUrls {
  readonly ownerUrl: string;
  readonly appUrl: string;
}

async function withClient(connectionString: string, work: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

export async function provisionTestDatabase(): Promise<TestDatabaseUrls> {
  await withClient(ADMIN_DATABASE_URL, async (admin) => {
    for (const role of [OWNER, APP]) {
      await admin.query(`
        do $$ begin
          if not exists (select from pg_roles where rolname = '${role}') then
            create role ${role} login password '${PASSWORD}';
          end if;
        end $$`);
    }
    await admin.query(`drop database if exists ${TEST_DATABASE} with (force)`);
    await admin.query(`create database ${TEST_DATABASE} owner ${OWNER}`);
    await admin.query(`revoke all on database ${TEST_DATABASE} from public`);
    await admin.query(`grant connect, temporary on database ${TEST_DATABASE} to ${APP}`);
  });

  const adminOnTestDb = new URL(ADMIN_DATABASE_URL);
  adminOnTestDb.pathname = `/${TEST_DATABASE}`;
  await withClient(adminOnTestDb.toString(), async (admin) => {
    await admin.query(`alter schema public owner to ${OWNER}`);
    await admin.query('revoke create on schema public from public');
    await admin.query(`grant usage on schema public to ${APP}`);
    await admin.query(
      `alter default privileges for role ${OWNER} in schema public grant select, insert, update, delete on tables to ${APP}`,
    );
    await admin.query(
      `alter default privileges for role ${OWNER} in schema public grant usage, select on sequences to ${APP}`,
    );
  });

  const urls = { ownerUrl: urlFor(OWNER, TEST_DATABASE), appUrl: urlFor(APP, TEST_DATABASE) };
  await migrateDatabase(urls.ownerUrl);
  return urls;
}
