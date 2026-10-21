import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, sendAll, webhookIdOf, type Fixture } from '../src/scenario.js';
import { Stack } from '../src/stack.js';
import { waitUntil } from '../src/wait.js';
import { say } from '../src/out.js';

/**
 * The dispatcher is killed (SIGKILL, no chance to clean up) while requests are in flight. Another
 * dispatcher starts; once the dead worker's leases expire, the interrupted deliveries are claimed
 * again and delivered. A request may therefore arrive twice, with the same webhook-id, but none is
 * lost.
 */
const MESSAGES = 20;
const HANDLER_DELAY_MS = 2_500;

describe('chaos: a worker crashes mid-delivery', () => {
  let stack: Stack;
  let fixture: Fixture;
  const dispatcherEnv = {
    DELIVERY_TIMEOUT_MS: '3000',
    DISPATCH_LEASE_SECONDS: '8',
    DISPATCH_PER_ENDPOINT: '10',
    RETRY_SCHEDULE_SECONDS: '0,2,2,2,2,2,2,2',
    RETRY_JITTER_RATIO: '0',
  };

  beforeAll(async () => {
    stack = await Stack.start({ dispatcherEnv });
    fixture = await createFixture(stack, 2);
  });
  afterAll(async () => {
    await Promise.all(fixture.receivers.map((receiver) => receiver.goDown()));
    await stack.stop();
  });

  it('delivers every message after the replacement worker takes over', async () => {
    for (const receiver of fixture.receivers) {
      receiver.mode = { kind: 'slow', delayMs: HANDLER_DELAY_MS };
    }
    const sent = await sendAll(stack, fixture, MESSAGES);
    const expected = new Set(sent.map((message) => webhookIdOf(message.messageId)));

    await waitUntil(
      'requests to be in flight',
      () => fixture.receivers.some((receiver) => receiver.receipts.length >= 3),
      30_000,
    );
    // Some deliveries are being held by the receivers: they are `in_progress` under a lease.
    await stack.dispatcher.crash();
    const interrupted = (await stack.deliveryCounts()).in_progress ?? 0;
    say('deliveries in flight when the worker was killed', interrupted);
    expect(interrupted).toBeGreaterThan(0);

    for (const receiver of fixture.receivers) receiver.mode = { kind: 'ok' };
    await stack.dispatcher.start(dispatcherEnv);

    await waitUntil(
      'every message to reach every endpoint',
      () => fixture.receivers.every((receiver) => receiver.distinctIds.size >= MESSAGES),
      90_000,
      () => fixture.receivers.map((r) => `${r.distinctIds.size}/${MESSAGES}`).join(' '),
    );
    await waitUntil(
      'every delivery to be recorded as delivered',
      async () => (await stack.deliveryCounts()).succeeded === MESSAGES * 2,
      60_000,
    );
    expect(await stack.deliveryCounts()).toEqual({ succeeded: MESSAGES * 2 });
    for (const receiver of fixture.receivers) {
      expect(receiver.distinctIds).toEqual(expected);
      // A repeat carries the same webhook-id and a valid signature, so the receiver can drop it.
      expect(receiver.receipts.every((receipt) => receipt.signatureValid)).toBe(true);
    }
  });
});
