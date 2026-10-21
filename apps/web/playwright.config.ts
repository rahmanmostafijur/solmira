import path from 'node:path';
import { defineConfig } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '../..');
const service = (name: string) => path.join(root, 'apps', name);
/** The browser enters through the gateway, exactly as a deployed console would. */
const GATEWAY_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const SECRETS_KEY = 'jwQOFPGSgMYBdzcMS4iBQfZGKQY8Iwi1LU+DxYyoREc=';
const DATABASE_PASSWORD = process.env.SERVICE_DB_PASSWORD ?? 'solmira_service_dev_password';
/** Compose publishes PostgreSQL on 5433 unless POSTGRES_PORT says otherwise. */
const POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5433';
const databaseUrl = (role: string, database: string) =>
  `postgres://${role}:${DATABASE_PASSWORD}@localhost:${POSTGRES_PORT}/${database}`;

/** Ingest reads the attempt history the dispatcher writes, so both point at DynamoDB Local. */
const attemptHistory = {
  DYNAMODB_ENDPOINT: 'http://localhost:8000',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
};

/** The receiver of the test is on loopback, so both services that check endpoint URLs allow it. */
const privateTargets = { ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true' };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One scenario drives a real stack, so run files one after another.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: GATEWAY_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      name: 'identity',
      command: 'node --env-file=.env dist/main.js',
      cwd: service('identity-service'),
      env: { DATABASE_URL: databaseUrl('identity_app', 'solmira_identity') },
      url: 'http://localhost:4001/health/ready',
      reuseExistingServer: !process.env.CI,
    },
    {
      name: 'ingest',
      command: 'node --env-file=.env dist/main.js',
      cwd: service('ingest-service'),
      env: {
        ...privateTargets,
        ...attemptHistory,
        DATABASE_URL: databaseUrl('ingest_app', 'solmira_ingest'),
      },
      url: 'http://localhost:4002/health/ready',
      reuseExistingServer: !process.env.CI,
    },
    {
      name: 'notification',
      command: 'node --env-file=.env dist/main.js',
      cwd: service('notification-service'),
      env: { DATABASE_URL: databaseUrl('notification_app', 'solmira_notification') },
      url: 'http://localhost:4003/health/ready',
      reuseExistingServer: !process.env.CI,
    },
    {
      name: 'analytics',
      command: 'node --env-file=.env dist/main.js',
      cwd: service('analytics-service'),
      env: { DATABASE_URL: databaseUrl('analytics_app', 'solmira_analytics') },
      url: 'http://localhost:4004/health/ready',
      reuseExistingServer: !process.env.CI,
    },
    {
      name: 'audit',
      command: 'node --env-file=.env dist/main.js',
      cwd: service('audit-service'),
      env: {
        DATABASE_URL: databaseUrl('audit_app', 'solmira_audit'),
        REDIS_URL: 'redis://localhost:6379',
      },
      url: 'http://localhost:4005/health/ready',
      reuseExistingServer: !process.env.CI,
    },
    {
      name: 'dispatcher',
      command: 'node dist/main.js',
      cwd: service('dispatcher'),
      env: {
        ...privateTargets,
        NODE_ENV: 'development',
        LOG_LEVEL: 'warn',
        PORT: '4006',
        DATABASE_URL: databaseUrl('dispatcher_app', 'solmira_ingest'),
        SECRETS_ENCRYPTION_KEY: SECRETS_KEY,
        REDIS_URL: 'redis://localhost:6379',
        ...attemptHistory,
        DYNAMODB_CREATE_TABLE: 'true',
        // A short schedule so a failing receiver exhausts its retries within the test.
        RETRY_SCHEDULE_SECONDS: '0,1',
        RETRY_JITTER_RATIO: '0',
        DISPATCH_POLL_MS: '200',
      },
      url: 'http://localhost:4006/health/ready',
      reuseExistingServer: !process.env.CI,
    },
    {
      name: 'web',
      command: 'pnpm exec next dev --port 3000',
      cwd: path.join(root, 'apps', 'web'),
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
