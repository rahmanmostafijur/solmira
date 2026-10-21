import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBroker, stopBroker } from '../src/infra.js';
import { createFixture, sendAll, webhookIdOf, type Fixture } from '../src/scenario.js';
import { Stack } from '../src/stack.js';
import { sleep, waitUntil } from '../src/wait.js';

/**
 * The broker goes down while events are being sent and comes back later. The ingestion API keeps
 * accepting events (they are committed with their outbox rows, ADR-0029), and once the broker is
 * back every event reaches every endpoint: nothing is lost, and a repeat is allowed (at least once).
 */
const BEFORE = 15;
const DURING = 30;

describe('chaos: the broker restarts', () => {
  let stack: Stack;
  let fixture: Fixture;

  beforeAll(async () => {
    stack = await Stack.start();
    fixture = await createFixture(stack, 2);
  });
  afterAll(async () => {
    try {
      startBroker();
    } catch {
      // Already running.
    }
    await Promise.all(fixture.receivers.map((receiver) => receiver.goDown()));
    await stack.stop();
  });

  it('accepts events during the outage and delivers every one after it', async () => {
    const before = await sendAll(stack, fixture, BEFORE);
    await waitUntil(
      'the first events to be delivered',
      async () => (await stack.deliveryCounts()).succeeded === BEFORE * 2,
      30_000,
    );

    stopBroker();
    const during = await sendAll(stack, fixture, DURING, BEFORE);
    // The API does not depend on the broker to accept an event.
    expect(during.every((message) => message.status === 202)).toBe(true);
    await sleep(3_000);
    for (const receiver of fixture.receivers) {
      expect(receiver.distinctIds.size, 'nothing is fanned out while the broker is down').toBe(
        BEFORE,
      );
    }

    startBroker();
    const all = [...before, ...during];
    const expected = new Set(all.map((message) => webhookIdOf(message.messageId)));
    await waitUntil(
      'every event to reach every endpoint after the broker returned',
      () => fixture.receivers.every((receiver) => receiver.distinctIds.size >= expected.size),
      120_000,
      () => fixture.receivers.map((r) => `${r.distinctIds.size}/${expected.size}`).join(' '),
    );
    for (const receiver of fixture.receivers) {
      expect(receiver.distinctIds).toEqual(expected);
      expect(receiver.receipts.every((receipt) => receipt.signatureValid)).toBe(true);
    }
    await waitUntil(
      'every delivery to be recorded as delivered',
      async () => (await stack.deliveryCounts()).succeeded === expected.size * 2,
      60_000,
    );
    expect(await stack.deliveryCounts()).toEqual({ succeeded: expected.size * 2 });
  });
});
