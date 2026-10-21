import path from 'node:path';
import { migrateDatabase } from '@solmira/ingest-service/migrations';
import {
  ADMIN_DATABASE_URL,
  provisionTestDatabase,
  startTestIssuer,
  type TestIssuer,
} from '@solmira/service-kit/testing';
import pg from 'pg';
import { ROOT, ensureVhost, rabbitmqUrl } from './infra.js';
import { ServiceProcess } from './process.js';
import { Tenant } from './tenant.js';

const DATABASE = 'solmira_resilience';
const OWNER_ROLE = 'resilience_owner';
const APP_ROLE = 'resilience_app';
const DISPATCHER_ROLE = 'resilience_dispatcher';
const ROLE_PASSWORD = 'service_test_password';
const VHOST = 'resilience';
const SECRETS_KEY = 'jwQOFPGSgMYBdzcMS4iBQfZGKQY8Iwi1LU+DxYyoREc=';
const INGEST_PORT = Number(process.env.RESILIENCE_INGEST_PORT ?? 4152);
const DISPATCHER_PORT = Number(process.env.RESILIENCE_DISPATCHER_PORT ?? 4156);

export interface StackOptions {
  /** Overrides for the ingest service's environment. */
  readonly ingestEnv?: Record<string, string>;
  /** Overrides for the dispatcher's environment (retry schedule, concurrency, timeouts). */
  readonly dispatcherEnv?: Record<string, string>;
  /** Start the dispatcher together with the stack (default). */
  readonly startDispatcher?: boolean;
}

/** DynamoDB Local and the broker settings shared by both services. */
const shared = (databaseUrl: string): Record<string, string> => ({
  NODE_ENV: 'development',
  LOG_LEVEL: 'warn',
  LOG_PRETTY: 'false',
  DATABASE_URL: databaseUrl,
  REDIS_URL: process.env.RESILIENCE_REDIS_URL ?? 'redis://localhost:6379',
  RABBITMQ_URL: rabbitmqUrl(VHOST),
  SECRETS_ENCRYPTION_KEY: SECRETS_KEY,
  DYNAMODB_ENDPOINT: process.env.RESILIENCE_DYNAMODB_URL ?? 'http://localhost:8000',
  DYNAMODB_TABLE: 'solmira-resilience-attempts',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
  // The receivers of the scenarios are on loopback.
  ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true',
});

function roleUrl(role: string): string {
  const url = new URL(ADMIN_DATABASE_URL);
  url.username = role;
  url.password = ROLE_PASSWORD;
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

/**
 * The ingest service (API, outbox relay, fan-out) and the dispatcher as real processes, against a
 * throwaway database, a broker vhost of their own, Redis and DynamoDB Local. The scenarios stop the
 * broker and kill the dispatcher the way an outage would; nothing is mocked.
 */
export class Stack {
  readonly ingestUrl = `http://127.0.0.1:${INGEST_PORT}/api/v1`;

  private constructor(
    readonly issuer: TestIssuer,
    readonly ingest: ServiceProcess,
    readonly dispatcher: ServiceProcess,
    readonly db: pg.Pool,
    private readonly spawnDispatcher: (port: number) => ServiceProcess,
  ) {}

  static async start(options: StackOptions = {}): Promise<Stack> {
    const owner = await Stack.provisionDatabase();
    ensureVhost(VHOST);
    const issuer = await startTestIssuer();
    const ingestDir = path.join(ROOT, 'apps', 'ingest-service');
    const dispatcherDir = path.join(ROOT, 'apps', 'dispatcher');

    const ingest = new ServiceProcess(
      'ingest-service',
      ingestDir,
      {
        ...shared(roleUrl(APP_ROLE)),
        PORT: String(INGEST_PORT),
        IDENTITY_JWKS_URL: issuer.jwksUrl,
        JWT_ISSUER: issuer.issuer,
        JWT_AUDIENCE: issuer.audience,
        // Scenarios send from one key; the default of 600 a minute would throttle them.
        INGEST_RATE_LIMIT_PER_MINUTE: '100000',
        ...options.ingestEnv,
      },
      `http://127.0.0.1:${INGEST_PORT}/health/ready`,
    );
    const dispatcher = new ServiceProcess(
      'dispatcher',
      dispatcherDir,
      {
        ...shared(roleUrl(DISPATCHER_ROLE)),
        PORT: String(DISPATCHER_PORT),
        DYNAMODB_CREATE_TABLE: 'true',
        DISPATCH_POLL_MS: '100',
        ...options.dispatcherEnv,
      },
      `http://127.0.0.1:${DISPATCHER_PORT}/health/ready`,
    );

    const dispatcherEnv = {
      ...shared(roleUrl(DISPATCHER_ROLE)),
      DYNAMODB_CREATE_TABLE: 'true',
      DISPATCH_POLL_MS: '100',
      ...options.dispatcherEnv,
    };
    const spawnDispatcher = (port: number) =>
      new ServiceProcess(
        'dispatcher',
        dispatcherDir,
        { ...dispatcherEnv, PORT: String(port) },
        `http://127.0.0.1:${port}/health/ready`,
      );
    const stack = new Stack(issuer, ingest, dispatcher, owner, spawnDispatcher);
    await ingest.start();
    if (options.startDispatcher !== false) await dispatcher.start();
    return stack;
  }

  private static async provisionDatabase(): Promise<pg.Pool> {
    const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`
        do $$ begin
          if not exists (select from pg_roles where rolname = '${DISPATCHER_ROLE}') then
            create role ${DISPATCHER_ROLE} login password '${ROLE_PASSWORD}';
          else
            alter role ${DISPATCHER_ROLE} login password '${ROLE_PASSWORD}';
          end if;
        end $$`);
    } finally {
      await admin.end();
    }
    const { ownerUrl } = await provisionTestDatabase({
      database: DATABASE,
      ownerRole: OWNER_ROLE,
      appRole: APP_ROLE,
      migrate: (url) => migrateDatabase(url, { dispatcherRole: DISPATCHER_ROLE }),
    });
    const onDatabase = new pg.Client({
      connectionString: ADMIN_DATABASE_URL.replace(/\/[^/]*$/, `/${DATABASE}`),
    });
    await onDatabase.connect();
    try {
      await onDatabase.query(
        `grant connect, temporary on database ${DATABASE} to ${DISPATCHER_ROLE}`,
      );
    } finally {
      await onDatabase.end();
    }
    return new pg.Pool({ connectionString: ownerUrl, max: 4 });
  }

  /** An additional dispatcher process (a second worker), on its own port. */
  extraDispatcher(index: number): ServiceProcess {
    return this.spawnDispatcher(DISPATCHER_PORT + index);
  }

  /** A new organization with an owner who can do everything, as seen by the API. */
  tenant(): Tenant {
    return new Tenant(this.ingestUrl, this.issuer);
  }

  /** Counts deliveries of the stack by status (the owner connection sees every tenant). */
  async deliveryCounts(): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ status: string; n: number }>(
      'select status, count(*)::int as n from deliveries group by status',
    );
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  }

  async stop(): Promise<void> {
    await this.dispatcher.stop();
    await this.ingest.stop();
    await this.db.end();
    await this.issuer.close();
  }
}
