// Builds the backend services the browser test runs against and applies their migrations.
// Infrastructure (PostgreSQL, Redis, RabbitMQ, DynamoDB Local, the gateway) must already be up:
//   pnpm infra:up
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

const password = process.env.SERVICE_DB_PASSWORD ?? 'solmira_service_dev_password';
/** Compose publishes PostgreSQL on 5433 unless POSTGRES_PORT says otherwise. */
const port = process.env.POSTGRES_PORT ?? '5433';
const owners = {
  'identity-service': 'identity_owner',
  'ingest-service': 'ingest_owner',
  'notification-service': 'notification_owner',
  'analytics-service': 'analytics_owner',
};
const databases = {
  'identity-service': 'solmira_identity',
  'ingest-service': 'solmira_ingest',
  'notification-service': 'solmira_notification',
  'analytics-service': 'solmira_analytics',
};

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(
  'pnpm',
  [
    'turbo',
    'run',
    'build',
    '--filter=@solmira/identity-service',
    '--filter=@solmira/ingest-service',
    '--filter=@solmira/dispatcher',
    '--filter=@solmira/notification-service',
    '--filter=@solmira/analytics-service',
  ],
  root,
);
// Ingest's migration also grants the dispatcher's narrow role access to the ingest tables.
for (const service of Object.keys(owners)) {
  run('node', ['--env-file=.env', 'dist/database/migrate.js'], path.join(root, 'apps', service), {
    MIGRATION_DATABASE_URL: `postgres://${owners[service]}:${password}@localhost:${port}/${databases[service]}`,
  });
}
