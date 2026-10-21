import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AttemptStore, createDynamoClients, ensureAttemptTable } from '@solmira/attempt-history';
import { permissionsForRole, type RoleKey } from '@solmira/contracts';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import { startTestIssuer, type TestIssuer } from '@solmira/service-kit/testing';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SERVICE_NAME, envSchema } from '../../src/config.js';

// DynamoDB Local accepts any credentials, but the SDK insists on having some.
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
const DYNAMODB_ENDPOINT = process.env.TEST_DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
  readonly auth: { Authorization: string };
}

/** DNS for tests: names resolve to what the test says, never to the network. */
export class FakeDns {
  private readonly answers = new Map<string, readonly string[]>();

  set(hostname: string, ...addresses: string[]): void {
    this.answers.set(hostname, addresses);
  }

  readonly resolve = async (hostname: string): Promise<readonly string[]> => {
    const answer = this.answers.get(hostname);
    if (!answer) throw new Error('ENOTFOUND ' + hostname);
    return answer;
  };
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly issuer: TestIssuer;
  readonly dns: FakeDns;
  /** Superuser-like connection as the schema owner, for assertions the runtime role cannot make. */
  readonly db: pg.Pool;
  /** The attempt history the service reads, for seeding attempts. */
  readonly attempts: AttemptStore;
  /** Everything the service logged, as text. */
  readonly logs: () => string;
  readonly http: () => ReturnType<typeof request>;
  /** A signed-in member of an organization with the given role's real permission set. */
  actor(organizationId: string, role: RoleKey): Promise<Actor>;
  close(): Promise<void>;
}

export const newOrganizationId = () => randomUUID();

/** The service wired to real PostgreSQL (as the RLS-restricted runtime role), Redis and RabbitMQ. */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const issuer = await startTestIssuer();
  const dns = new FakeDns();
  dns.set('hooks.example.com', '93.184.216.34');
  const captured: string[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      captured.push(chunk.toString('utf8'));
      done();
    },
  });
  const table = 'attempts-' + randomUUID().slice(0, 8);
  const dynamo = createDynamoClients({ region: 'us-east-1', endpoint: DYNAMODB_ENDPOINT });
  await ensureAttemptTable(dynamo.raw, table);
  const attempts = new AttemptStore(dynamo.documents, table, 30);
  const config = loadConfig(envSchema, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'debug',
    DATABASE_URL: inject('appDatabaseUrl'),
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    RABBITMQ_URL:
      process.env.TEST_RABBITMQ_URL ?? 'amqp://solmira:solmira_dev_password@localhost:5672',
    IDENTITY_JWKS_URL: issuer.jwksUrl,
    SECRETS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    OUTBOX_RELAY_POLL_MS: '50',
    DYNAMODB_ENDPOINT,
    DYNAMODB_TABLE: table,
    ...overrides,
  });
  const app = await createServiceApp(
    AppModule.register(config, { resolver: dns.resolve, logStream, attempts }),
    { serviceName: SERVICE_NAME, nodeEnv: 'test' },
  );
  await app.init();
  const db = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });

  return {
    app,
    issuer,
    dns,
    db,
    attempts,
    logs: () => captured.join(''),
    http: () => request(app.getHttpServer()),
    async actor(organizationId, role) {
      const userId = randomUUID();
      const token = await issuer.sign({
        userId,
        sessionId: randomUUID(),
        organizationId,
        role,
        permissions: permissionsForRole(role),
      });
      return { organizationId, userId, auth: { Authorization: 'Bearer ' + token } };
    },
    async close() {
      await app.close();
      await db.end();
      await issuer.close();
    },
  };
}
