import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import pg from 'pg';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SERVICE_NAME, envSchema } from '../../src/config.js';
import { DispatcherService } from '../../src/dispatcher.service.js';
import { AttemptStore } from '../../src/history/attempt-store.js';
import { createDynamoClients } from '../../src/history/dynamodb.js';
import { TEST_KEY } from './seed.js';

// DynamoDB Local accepts any credentials, but the SDK insists on having some.
process.env.AWS_ACCESS_KEY_ID ??= 'local';
process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
process.env.AWS_REGION ??= 'us-east-1';

export const DYNAMODB_ENDPOINT = process.env.TEST_DYNAMODB_ENDPOINT ?? 'http://localhost:8000';

export interface TestDispatcher {
  readonly app: NestExpressApplication;
  readonly dispatcher: DispatcherService;
  /** The owner connection, for seeding and for assertions the dispatcher role cannot make. */
  readonly db: pg.Pool;
  /** Reads the attempt history the way the API will. */
  readonly attempts: AttemptStore;
  readonly table: string;
  close(): Promise<void>;
}

/** A DNS stand-in: every name resolves to loopback unless a test says otherwise. */
export const loopbackResolver = async () => ['127.0.0.1'];

export async function createTestDispatcher(
  overrides: Record<string, string> = {},
  resolver: (hostname: string) => Promise<readonly string[]> = loopbackResolver,
): Promise<TestDispatcher> {
  const table = 'attempts-' + randomUUID().slice(0, 8);
  const config = loadConfig(envSchema, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('dispatcherDatabaseUrl'),
    SECRETS_ENCRYPTION_KEY: TEST_KEY,
    ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true',
    DISPATCH_AUTOSTART: 'false',
    DYNAMODB_ENDPOINT,
    DYNAMODB_TABLE: table,
    DYNAMODB_CREATE_TABLE: 'true',
    RETRY_SCHEDULE_SECONDS: '0,2,4,6',
    DELIVERY_CONNECT_TIMEOUT_MS: '500',
    DELIVERY_TIMEOUT_MS: '1500',
    DISPATCH_LEASE_SECONDS: '10',
    ...overrides,
  });
  const app = await createServiceApp(AppModule.register(config, { resolver }), {
    serviceName: SERVICE_NAME,
    nodeEnv: 'test',
  });
  await app.init();
  const dynamo = createDynamoClients({ region: 'us-east-1', endpoint: DYNAMODB_ENDPOINT });
  const db = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });
  return {
    app,
    dispatcher: app.get(DispatcherService),
    db,
    attempts: new AttemptStore(dynamo.documents, table, config.ATTEMPT_RETENTION_DAYS),
    table,
    async close() {
      await app.close();
      await db.end();
    },
  };
}

export async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}
