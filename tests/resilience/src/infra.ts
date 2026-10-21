import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The repository root, found by its workspace file so it is the same from source and from dist. */
function findRoot(): string {
  let directory = import.meta.dirname;
  for (;;) {
    if (existsSync(path.join(directory, 'pnpm-workspace.yaml'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('The repository root was not found');
    directory = parent;
  }
}

export const ROOT = findRoot();

/** Runs `docker compose` from the repository root; used to stop and start the broker. */
export function compose(...args: string[]): string {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

export const RABBITMQ_USER = 'solmira';
export const RABBITMQ_PASSWORD = process.env.RABBITMQ_PASSWORD ?? 'solmira_dev_password';
export const RABBITMQ_PORT = process.env.RABBITMQ_PORT ?? '5672';

/** The broker's own vhost for a stack, so a scenario never shares queues with a developer's. */
export function ensureVhost(vhost: string): void {
  try {
    compose('exec', '-T', 'rabbitmq', 'rabbitmqctl', 'add_vhost', vhost);
  } catch (error) {
    if (!String(error).includes('already')) throw error;
  }
  compose(
    'exec',
    '-T',
    'rabbitmq',
    'rabbitmqctl',
    'set_permissions',
    '-p',
    vhost,
    RABBITMQ_USER,
    '.*',
    '.*',
    '.*',
  );
}

export const rabbitmqUrl = (vhost: string) =>
  `amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:${RABBITMQ_PORT}/${vhost}`;

export function stopBroker(): void {
  compose('stop', 'rabbitmq');
}

/** Starts the broker and waits until it answers, so the next step does not race its boot. */
export function startBroker(): void {
  compose('start', 'rabbitmq');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'rabbitmq', 'rabbitmq-diagnostics', '-q', 'ping'],
      {
        cwd: ROOT,
        shell: process.platform === 'win32',
      },
    );
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  throw new Error('The broker did not come back in time');
}
