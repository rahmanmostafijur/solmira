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
 * One of four endpoints of a tenant goes down (connections refused) while 60 events are sent. A
 * control burst with every endpoint healthy comes first, so the healthy endpoints are compared with
 * what the pipeline does anyway: they must stay within a stated factor of it. Nothing may be lost:
 * when the broken endpoint comes back, it receives all 60 events.
 */
const MESSAGES = 60;
const ABSOLUTE_BOUND_MS = 5_000;
const FACTOR_OF_CONTROL = 2;

describe('chaos: an endpoint is down', () => {
  let stack: Stack;
  let fixture: Fixture;

  beforeAll(async () => {
    stack = await Stack.start({
      dispatcherEnv: {
        // Eight tries two seconds apart, and a circuit that reopens quickly, keep the scenario short.
        RETRY_SCHEDULE_SECONDS: '0,2,2,2,2,2,2,2',
        RETRY_JITTER_RATIO: '0',
        CIRCUIT_FAILURE_THRESHOLD: '3',
        CIRCUIT_COOLDOWN_BASE_SECONDS: '2',
        CIRCUIT_COOLDOWN_MAX_SECONDS: '4',
      },
    });
    fixture = await createFixture(stack, 4);
  });
  afterAll(async () => {
    await Promise.all(fixture.receivers.map((receiver) => receiver.goDown()));
    await stack.stop();
  });

  it('keeps the healthy endpoints as fast as without the fault, and loses nothing', async () => {
    const [broken, ...healthy] = fixture.receivers;

    // Control: the same burst with every endpoint healthy.
    const control = await sendAll(stack, fixture, MESSAGES);
    await waitUntil(
      'the control burst to be delivered everywhere',
      () => fixture.receivers.every((receiver) => receiver.distinctIds.size >= MESSAGES),
      30_000,
    );
    const baseline = distribution(receiptLatencies(healthy, control));

    // Fault: one endpoint refuses connections during the next burst.
    await broken!.goDown();
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
    say('one endpoint down, healthy endpoints (ms)', JSON.stringify(withFault));
    expect(withFault.p95).toBeLessThan(ABSOLUTE_BOUND_MS);
    expect(withFault.p95).toBeLessThan(baseline.p95 * FACTOR_OF_CONTROL);
    for (const receiver of healthy) {
      expect(receiver.receipts.every((receipt) => receipt.signatureValid)).toBe(true);
    }

    // The broken endpoint comes back while its retries are still running: every message arrives.
    await sleep(2_000);
    await broken!.listen();
    await waitUntil(
      'the recovered endpoint to receive every message of the burst',
      () => [...expected].every((id) => broken!.distinctIds.has(id)),
      60_000,
      () => `${broken!.distinctIds.size} of ${total}`,
    );
    expect(broken!.receipts.every((receipt) => receipt.signatureValid)).toBe(true);

    // Every delivery of the tenant ends as delivered: none pending, none failed, none lost.
    await waitUntil(
      'every delivery to finish',
      async () => (await stack.deliveryCounts()).succeeded === total * 4,
      30_000,
    );
    expect(await stack.deliveryCounts()).toEqual({ succeeded: total * 4 });
  });
});
