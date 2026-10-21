import { execSync } from 'node:child_process';
import os from 'node:os';
import type { Distribution } from '../src/wait.js';

/** What the numbers were measured on. A result without this is not worth keeping. */
export function environment() {
  const git = (command: string) => {
    try {
      return execSync(command, { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  const cpus = os.cpus();
  return {
    measuredAt: new Date().toISOString(),
    commit: git('git rev-parse --short HEAD'),
    dirty: git('git status --porcelain') !== '',
    node: process.version,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    cpu: `${cpus[0]?.model ?? 'unknown'} x ${cpus.length}`,
    memoryGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    topology:
      'Everything on one machine: the load generator, the receivers, the ingest service, the ' +
      'dispatcher, PostgreSQL, Redis, RabbitMQ and DynamoDB Local (the last four in Docker).',
  };
}

export const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export const rounded = (d: Distribution) => ({
  count: d.count,
  minMs: round(d.min),
  p50Ms: round(d.p50),
  p95Ms: round(d.p95),
  p99Ms: round(d.p99),
  maxMs: round(d.max),
});
