/**
 * The load test (docs/performance/README.md). It measures three things on the real services and
 * writes what it measured, with the environment, to docs/performance/results. Nothing here is a
 * target or an estimate: a figure appears only if this run produced it.
 *
 *   1. Ingestion: events accepted per second and the API's response time, with the dispatcher stopped.
 *   2. Dispatch: deliveries completed per second while draining the backlog of step 1.
 *   3. End to end: delivery latency (send to receipt) under a steady offered rate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/infra.js';
import { Receiver } from '../src/receivers.js';
import { Stack } from '../src/stack.js';
import { webhookIdOf } from '../src/scenario.js';
import type { Sent } from '../src/tenant.js';
import { distribution, sleep, waitUntil } from '../src/wait.js';
import { sendAtRate, sendClosedLoop, type Target } from './pool.js';
import { environment, round, rounded } from './report.js';
import { say, warn } from '../src/out.js';

const number = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
/** Dispatcher settings to run with, as JSON, for example {"DISPATCH_PER_ENDPOINT":"20"}. */
const dispatcherEnv = JSON.parse(process.env.LOAD_DISPATCHER_ENV ?? '{}') as Record<string, string>;
const settings = {
  dispatcherEnv,
  ingestMessages: number('LOAD_INGEST_MESSAGES', 3000),
  ingestConcurrency: number('LOAD_INGEST_CONCURRENCY', 50),
  endpoints: number('LOAD_ENDPOINTS', 3),
  apiKeys: number('LOAD_API_KEYS', 4),
  steadyRatesPerSecond: (process.env.LOAD_STEADY_RATES ?? '20,40,60,80').split(',').map(Number),
  steadySeconds: number('LOAD_STEADY_SECONDS', 20),
};

async function main() {
  const stack = await Stack.start({ startDispatcher: false, dispatcherEnv });
  const receivers: Receiver[] = [];
  try {
    const tenant = stack.tenant();
    const eventType = 'load.test';
    const eventTypeId = await tenant.createEventType(eventType);
    const applicationId = await tenant.createApplication('Load');
    const apiKeys = await Promise.all(
      Array.from({ length: settings.apiKeys }, () => tenant.createApiKey(applicationId)),
    );
    for (let i = 0; i < settings.endpoints; i += 1) {
      const receiver = new Receiver();
      await receiver.listen();
      receiver.secret = (
        await tenant.createEndpoint(applicationId, receiver.url, [eventTypeId])
      ).signingSecret;
      receivers.push(receiver);
    }
    const target: Target = { baseUrl: stack.ingestUrl, applicationId, apiKeys, eventType };
    const fanOut = settings.endpoints;

    // Warm-up, not measured: connections, JIT, caches.
    await sendClosedLoop(target, 200, 20);
    await stack.dispatcher.start();
    await waitUntil(
      'the warm-up to finish',
      async () => (await stack.deliveryCounts()).succeeded === 200 * fanOut,
      120_000,
    );
    await stack.dispatcher.stop();
    receivers.forEach((receiver) => (receiver.receipts.length = 0));

    // 1. Ingestion with the dispatcher stopped.
    const ingestStart = performance.now();
    const ingested = await sendClosedLoop(
      target,
      settings.ingestMessages,
      settings.ingestConcurrency,
    );
    const ingestSeconds = (performance.now() - ingestStart) / 1000;
    const accepted = ingested.filter((message) => message.status === 202);
    const ingestion = {
      sent: ingested.length,
      accepted: accepted.length,
      rejected: ingested.length - accepted.length,
      seconds: round(ingestSeconds, 2),
      acceptedPerSecond: round(accepted.length / ingestSeconds),
      responseTime: rounded(distribution(accepted.map((m) => m.acceptedAt - m.sentAt))),
    };

    // 2. Dispatch: the fan-out finishes without a dispatcher, then the backlog drains.
    const expectedDeliveries = accepted.length * fanOut;
    const baseline = (await stack.deliveryCounts()).succeeded ?? 0;
    await waitUntil(
      'the fan-out to finish',
      async () => (await stack.deliveryCounts()).pending === expectedDeliveries,
      300_000,
    );
    const drainStart = performance.now();
    await stack.dispatcher.start();
    await waitUntil(
      'the backlog to drain',
      async () => ((await stack.deliveryCounts()).succeeded ?? 0) - baseline === expectedDeliveries,
      600_000,
    );
    const drainSeconds = (performance.now() - drainStart) / 1000;
    const dispatch = {
      deliveries: expectedDeliveries,
      seconds: round(drainSeconds, 2),
      deliveriesPerSecond: round(expectedDeliveries / drainSeconds),
    };
    receivers.forEach((receiver) => (receiver.receipts.length = 0));

    // 3. Steady offered rates with the backlog empty: the latency a customer sees, per rate.
    const endToEnd = [];
    for (const rate of settings.steadyRatesPerSecond) {
      receivers.forEach((receiver) => (receiver.receipts.length = 0));
      await sleep(1_000);
      const steady = await sendAtRate(target, rate, settings.steadySeconds);
      const finished = performance.now();
      await waitUntil(
        `the deliveries of ${rate} messages a second`,
        () => receivers.every((r) => r.distinctIds.size >= steady.length),
        300_000,
      );
      const sentAt = new Map(steady.map((m: Sent) => [webhookIdOf(m.messageId), m.sentAt]));
      const latencies = receivers.flatMap((receiver) => {
        const seen = new Set<string>();
        return receiver.receipts.flatMap((receipt) => {
          const start = sentAt.get(receipt.webhookId);
          if (start === undefined || seen.has(receipt.webhookId)) return [];
          seen.add(receipt.webhookId);
          return [receipt.receivedAt - start];
        });
      });
      endToEnd.push({
        offeredMessagesPerSecond: rate,
        offeredDeliveriesPerSecond: rate * fanOut,
        seconds: settings.steadySeconds,
        messages: steady.length,
        secondsToFinishAfterLastSend: round((performance.now() - finished) / 1000, 2),
        latency: rounded(distribution(latencies)),
        invalidSignatures: receivers.reduce(
          (n, r) => n + r.receipts.filter((x) => !x.signatureValid).length,
          0,
        ),
      });
    }

    const result = { environment: environment(), settings, ingestion, dispatch, endToEnd };
    const directory = path.join(ROOT, 'docs', 'performance', 'results');
    mkdirSync(directory, { recursive: true });
    const file = path.join(
      directory,
      `${result.environment.measuredAt.replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
    say(JSON.stringify(result, null, 2));
    say(`\nWritten to ${path.relative(ROOT, file)}`);
  } finally {
    if (process.env.LOAD_SHOW_LOGS) {
      warn(`--- ingest-service ---
${stack.ingest.recentLog}`);
      warn(`--- dispatcher ---
${stack.dispatcher.recentLog}`);
    }
    await Promise.all(receivers.map((receiver) => receiver.goDown()));
    await stack.stop();
  }
}

await main();
