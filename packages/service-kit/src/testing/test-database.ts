import pg from 'pg';

export interface TestDatabaseOptions {
  /** e.g. `solmira_operations_test`. Dropped and recreated on every run. */
  readonly database: string;
  readonly ownerRole: string;
  readonly appRole: string;
  /** Applies the service's migrations; always called with the owner connection string. */
  readonly migrate: (ownerUrl: string) => Promise<void>;
}

export interface TestDatabaseUrls {
  readonly ownerUrl: string;
  readonly appUrl: string;
}

const PASSWORD = 'service_test_password';

export const ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://solmira:solmira_dev_password@localhost:5433/postgres';

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function urlFor(user: string, database: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.username = user;
  url.password = PASSWORD;
  url.pathname = `/${database}`;
  return url.toString();
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

/**
 * Builds a throwaway database that mirrors production privileges: an owner role that runs
 * migrations and a separate runtime role that Row Level Security applies to. Tests then run the
 * application as the runtime role, exactly as deployed.
 */
export async function provisionTestDatabase(
  options: TestDatabaseOptions,
): Promise<TestDatabaseUrls> {
  const { database, ownerRole, appRole } = options;
  for (const identifier of [database, ownerRole, appRole]) {
    if (!IDENTIFIER.test(identifier)) throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  await withClient(ADMIN_DATABASE_URL, async (admin) => {
    for (const role of [ownerRole, appRole]) {
      // Test-only roles: (re)set the password every run so the helper is the single source of it.
      await admin.query(`
        do $$ begin
          if not exists (select from pg_roles where rolname = '${role}') then
            create role ${role} login password '${PASSWORD}';
          else
            alter role ${role} login password '${PASSWORD}';
          end if;
        end $$`);
    }
    await admin.query(`drop database if exists ${database} with (force)`);
    await admin.query(`create database ${database} owner ${ownerRole}`);
    await admin.query(`revoke all on database ${database} from public`);
    await admin.query(`grant connect, temporary on database ${database} to ${appRole}`);
  });

  const adminOnDatabase = new URL(ADMIN_DATABASE_URL);
  adminOnDatabase.pathname = `/${database}`;
  await withClient(adminOnDatabase.toString(), async (admin) => {
    await admin.query(`alter schema public owner to ${ownerRole}`);
    await admin.query('revoke create on schema public from public');
    await admin.query(`grant usage on schema public to ${appRole}`);
    await admin.query(
      `alter default privileges for role ${ownerRole} in schema public grant select, insert, update, delete on tables to ${appRole}`,
    );
    await admin.query(
      `alter default privileges for role ${ownerRole} in schema public grant usage, select on sequences to ${appRole}`,
    );
  });

  const urls = { ownerUrl: urlFor(ownerRole, database), appUrl: urlFor(appRole, database) };
  await options.migrate(urls.ownerUrl);
  return urls;
}
