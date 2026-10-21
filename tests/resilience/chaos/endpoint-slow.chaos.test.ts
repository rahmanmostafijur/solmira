import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createFixture,
  receiptLatencies,
  sendAll,
  webhookIdOf,
  type Fixture,
} from '../src/scenario.js';
import { Stack } from '../src/stack.js';
import { distribution, sleep, waitUntil } from '../src/wait.js';
import { say } from '../src/out.js';

/**
 * One of four endpoints answers slower than the sender's timeout, so every attempt to it times out
 * and occupies a worker for the whole timeout. A control burst with every endpoint healthy comes
 * first; the other three must stay within a stated factor of it, because the slow endpoint may use
 * only its own share of the workers (the per-endpoint cap). When it recovers, its deliveries
 * complete too.
 */
const MESSAGES = 20;
const TIMEOUT_MS = 2_000;
const ABSOLUTE_BOUND_MS = 5_000;
const FACTOR_OF_CONTROL = 2;

describe('chaos: an endpoint is slow', () => {
  let stack: Stack;
  let fixture: Fixture;

  beforeAll(async () => {
    stack = await Stack.start({
      dispatcherEnv: {
        DELIVERY_TIMEOUT_MS: String(TIMEOUT_MS),
        DISPATCH_LEASE_SECONDS: '10',
        DISPATCH_CONCURRENCY: '10',
        DISPATCH_PER_ENDPOINT: '5',
        RETRY_SCHEDULE_SECONDS: '0,3,3,3,3,3,3,3',
        RETRY_JITTER_RATIO: '0',
      },
    });
    fixture = await createFixture(stack, 4);
  });
  afterAll(async () => {
    await Promise.all(fixture.receivers.map((receiver) => receiver.goDown()));
    await stack.stop();
  });

  it('keeps the healthy endpoints as fast as without the fault, and the slow one catches up', async () => {
    const [slow, ...healthy] = fixture.receivers;

    // Control: the same burst with every endpoint healthy.
    const control = await sendAll(stack, fixture, MESSAGES);
    await waitUntil(
      'the control burst to be delivered everywhere',
      () => fixture.receivers.every((receiver) => receiver.distinctIds.size >= MESSAGES),
      30_000,
    );
    const baseline = distribution(receiptLatencies(healthy, control));

    // Fault: one endpoint takes twice the sender's timeout to answer.
    slow!.mode = { kind: 'slow', delayMs: TIMEOUT_MS * 2 };
    const sent = await sendAll(stack, fixture, MESSAGES, MESSAGES);
    expect(sent.every((message) => message.status === 202)).toBe(true);
    const expected = new Set(sent.map((message) => webhookIdOf(message.messageId)));
    const total = MESSAGES * 2;
    await waitUntil(
      'the healthy endpoints to receive every message',
      () => healthy.every((receiver) => receiver.distinctIds.size >= total),
      30_000,
      () => healthy.map((receiver) => receiver.distinctIds.size).join(','),
    );
    const withFault = distribution(receiptLatencies(healthy, sent));
    say('control, send to receipt (ms)', JSON.stringify(baseline));
    say('one endpoint slow, healthy endpoints (ms)', JSON.stringify(withFault));
    expect(withFault.p95).toBeLessThan(ABSOLUTE_BOUND_MS);
    expect(withFault.p95).toBeLessThan(baseline.p95 * FACTOR_OF_CONTROL);

    // The slow endpoint is still timing out: its deliveries wait for retries, they are not lost.
    expect((await stack.deliveryCounts()).succeeded).toBeGreaterThanOrEqual(
      MESSAGES * 4 + MESSAGES * 3,
    );

    await sleep(1_000);
    slow!.mode = { kind: 'ok' };
    await waitUntil(
      'every delivery to finish',
      async () => (await stack.deliveryCounts()).succeeded === total * 4,
      60_000,
    );
    expect(await stack.deliveryCounts()).toEqual({ succeeded: total * 4 });
    for (const id of expected) expect(slow!.distinctIds.has(id)).toBe(true);
  });
});
