import { migrateDatabase } from '@solmira/ingest-service/migrations';
import { ADMIN_DATABASE_URL, provisionTestDatabase } from '@solmira/service-kit/testing';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    dispatcherDatabaseUrl: string;
  }
}

const DATABASE = 'solmira_dispatcher_test';
const DISPATCHER_ROLE = 'dispatcher_test_app';
const PASSWORD = 'service_test_password';

/**
 * A fresh database migrated by the real ingest-service migrations, with the dispatcher's own role
 * granted only what the migration step grants it. The dispatcher tests run as that role.
 */
export default async function setup(project: TestProject): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`
      do $$ begin
        if not exists (select from pg_roles where rolname = '${DISPATCHER_ROLE}') then
          create role ${DISPATCHER_ROLE} login password '${PASSWORD}';
        else
          alter role ${DISPATCHER_ROLE} login password '${PASSWORD}';
        end if;
      end $$`);
  } finally {
    await admin.end();
  }

  const { ownerUrl } = await provisionTestDatabase({
    database: DATABASE,
    ownerRole: 'ingest_dispatch_owner',
    appRole: 'ingest_dispatch_app',
    migrate: (url) => migrateDatabase(url, { dispatcherRole: DISPATCHER_ROLE }),
  });

  const adminOnDatabase = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  await adminOnDatabase.connect();
  try {
    await adminOnDatabase.query(
      `grant connect, temporary on database ${DATABASE} to ${DISPATCHER_ROLE}`,
    );
  } finally {
    await adminOnDatabase.end();
  }

  const dispatcherUrl = new URL(ownerUrl);
  dispatcherUrl.username = DISPATCHER_ROLE;
  dispatcherUrl.password = PASSWORD;
  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('dispatcherDatabaseUrl', dispatcherUrl.toString());
}
