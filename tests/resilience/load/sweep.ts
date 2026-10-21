/**
 * Dispatch capacity under different worker settings. One backlog is created once; for each setting
 * the deliveries are put back to pending and drained again, so every row drains the same work. It
 * answers "what limits deliveries per second on this machine" with measurements, not guesses.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/infra.js';
import { Receiver } from '../src/receivers.js';
import { cpuSeconds } from '../src/process.js';
import { Stack } from '../src/stack.js';
import { waitUntil } from '../src/wait.js';
import { sendClosedLoop } from './pool.js';
import { environment, round } from './report.js';
import { say } from '../src/out.js';

const MESSAGES = Number(process.env.SWEEP_MESSAGES ?? 1500);
const ENDPOINTS = Number(process.env.SWEEP_ENDPOINTS ?? 3);
/**
 * `concurrency:pool:workers:perEndpoint`, for example 20:10:2:5 is two workers of 20 deliveries and
 * 10 connections each, with at most 5 requests in flight to any one endpoint.
 */
const CONFIGS = (
  process.env.SWEEP_CONFIGS ?? '20:10:1:5,20:10:1:10,50:20:1:20,100:50:1:50,50:20:2:50'
)
  .split(',')
  .map((spec) => {
    const [concurrency, poolMax, workers, perEndpoint] = spec.split(':').map(Number);
    return {
      concurrency: concurrency!,
      poolMax: poolMax!,
      workers: workers ?? 1,
      perEndpoint: perEndpoint ?? 5,
    };
  });

async function main() {
  const stack = await Stack.start({ startDispatcher: false });
  const receivers: Receiver[] = [];
  try {
    const tenant = stack.tenant();
    const eventTypeId = await tenant.createEventType('sweep.test');
    const applicationId = await tenant.createApplication('Sweep');
    const apiKeys = await Promise.all(
      Array.from({ length: 4 }, () => tenant.createApiKey(applicationId)),
    );
    for (let i = 0; i < ENDPOINTS; i += 1) {
      const receiver = new Receiver();
      await receiver.listen();
      receiver.secret = (
        await tenant.createEndpoint(applicationId, receiver.url, [eventTypeId])
      ).signingSecret;
      receivers.push(receiver);
    }
    await sendClosedLoop(
      { baseUrl: stack.ingestUrl, applicationId, apiKeys, eventType: 'sweep.test' },
      MESSAGES,
      50,
    );
    const total = MESSAGES * ENDPOINTS;
    await waitUntil(
      'the fan-out',
      async () => (await stack.deliveryCounts()).pending === total,
      300_000,
    );

    const rows = [];
    for (const config of CONFIGS) {
      await stack.db.query(
        `update deliveries set status = 'pending', attempt_count = 0, next_attempt_at = now(),
                locked_until = null, completed_at = null, last_attempt_at = null,
                last_status_code = null, last_error_class = null, cycle_base = 0`,
      );
      const env = {
        DISPATCH_CONCURRENCY: String(config.concurrency),
        DATABASE_POOL_MAX: String(config.poolMax),
        DISPATCH_BATCH_SIZE: String(Math.min(500, config.concurrency)),
        DISPATCH_PER_ENDPOINT: String(config.perEndpoint),
      };
      const workers = [
        stack.dispatcher,
        ...Array.from({ length: config.workers - 1 }, (_, i) => stack.extraDispatcher(i + 1)),
      ];
      const started = performance.now();
      await Promise.all(workers.map((worker) => worker.start(env)));
      const cpuBefore = workers.map((worker) => cpuSeconds(worker.pid!));
      const cpuStarted = performance.now();
      await waitUntil(
        `the drain at ${JSON.stringify(config)}`,
        async () => (await stack.deliveryCounts()).succeeded === total,
        600_000,
      );
      const seconds = (performance.now() - started) / 1000;
      const cpuAfter = workers.map((worker) => cpuSeconds(worker.pid!));
      const busy = (performance.now() - cpuStarted) / 1000;
      const cpuPerWorker = workers.map((_, i) =>
        cpuBefore[i] === null || cpuAfter[i] === null
          ? null
          : round(((cpuAfter[i]! - cpuBefore[i]!) / busy) * 100, 0),
      );
      await Promise.all(workers.map((worker) => worker.stop()));
      rows.push({
        ...config,
        deliveries: total,
        seconds: round(seconds, 2),
        deliveriesPerSecond: round(total / seconds),
        workerCpuPercent: cpuPerWorker,
      });
      say(JSON.stringify(rows.at(-1)));
    }

    const result = { environment: environment(), messages: MESSAGES, endpoints: ENDPOINTS, rows };
    const directory = path.join(ROOT, 'docs', 'performance', 'results');
    mkdirSync(directory, { recursive: true });
    const file = path.join(
      directory,
      `sweep-${result.environment.measuredAt.replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    say(`\nWritten to ${path.relative(ROOT, file)}`);
  } finally {
    await Promise.all(receivers.map((receiver) => receiver.goDown()));
    await stack.stop();
  }
}

await main();
