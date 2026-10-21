import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATTEMPT_STORE } from '../src/dispatcher.tokens.js';
import type { AttemptStore } from '@solmira/attempt-history';
import { seedDelivery } from './support/seed.js';
import { startServer, type TestServer } from './support/test-server.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

describe('when the attempt history is unavailable', () => {
  let t: TestDispatcher;
  let receiver: TestServer;

  beforeAll(async () => {
    t = await createTestDispatcher();
    receiver = await startServer((_request, response) => response.writeHead(200).end('ok'));
  });
  afterAll(async () => {
    await receiver.close();
    await t.close();
  });

  it('still advances the delivery, after trying the write a few times', async () => {
    const store = t.app.get<AttemptStore>(ATTEMPT_STORE);
    const original = store.record.bind(store);
    let writes = 0;
    store.record = async () => {
      writes += 1;
      throw new Error('DynamoDB is unavailable');
    };

    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port });
    await t.dispatcher.drainOnce();

    const row = (
      await t.db.query(
        'select status, attempt_count, last_status_code from deliveries where id = $1',
        [fixture.deliveryId],
      )
    ).rows[0];
    expect(row).toMatchObject({ status: 'succeeded', attempt_count: 1, last_status_code: 200 });
    expect(receiver.requests).toHaveLength(1);
    expect(writes).toBe(3);

    store.record = original;
    const history = await t.attempts.listForDelivery(
      fixture.organizationId,
      fixture.messageId,
      fixture.endpointId,
    );
    expect(history).toEqual([]); // the lost record is a gap in derived data, not in the delivery
  });

  // Regression: the console showed "sending" for a delivery the receiver had already accepted,
  // because the state waited for the history write (and its retries) to finish (ADR-0040).
  it('records the outcome before the history write finishes', async () => {
    const store = t.app.get<AttemptStore>(ATTEMPT_STORE);
    const original = store.record.bind(store);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let statusDuringWrite: unknown;
    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port });
    store.record = async (record) => {
      statusDuringWrite = (
        await t.db.query('select status from deliveries where id = $1', [fixture.deliveryId])
      ).rows[0]?.status;
      await held;
      return original(record);
    };

    const drained = t.dispatcher.drainOnce();
    await expect.poll(() => statusDuringWrite).toBe('succeeded');
    release();
    await drained;
    store.record = original;

    const history = await t.attempts.listForDelivery(
      fixture.organizationId,
      fixture.messageId,
      fixture.endpointId,
    );
    expect(history).toHaveLength(1);
  });
});
