// Builds the services the scenarios run as processes. Infrastructure must be up: pnpm infra:up
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const result = spawnSync(
  'pnpm',
  ['turbo', 'run', 'build', '--filter=@solmira/ingest-service', '--filter=@solmira/dispatcher'],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
