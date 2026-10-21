import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClaimedDelivery, DeliveryRepository } from '../src/database/delivery-repository.js';
import { DELIVERY_REPOSITORY } from '../src/dispatcher.tokens.js';
import { seedDelivery } from './support/seed.js';
import { startServer, type TestServer } from './support/test-server.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

describe('recovering from worker failures', () => {
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

  const url = () => 'http://hooks.test:' + receiver.port;
  const sentFor = (marker: string) => receiver.requests.filter((r) => r.body.includes(marker));
  const stateOf = async (deliveryId: string) =>
    (await t.db.query('select status, attempt_count from deliveries where id = $1', [deliveryId]))
      .rows[0];

  it('sends again with the same webhook id when a worker dies after sending and before recording', async () => {
    const marker = 'crash-' + randomUUID();
    const fixture = await seedDelivery(t.db, { url: url(), payload: { marker } });
    const repository = t.app.get<DeliveryRepository>(DELIVERY_REPOSITORY);
    const record = repository.recordOutcome.bind(repository);
    let crashed = false;
    repository.recordOutcome = async (claimed, outcome) => {
      if (!crashed && claimed.deliveryId === fixture.deliveryId) {
        crashed = true;
        throw new Error('worker killed before recording');
      }
      return record(claimed, outcome);
    };

    await t.dispatcher.drainOnce();
    expect(sentFor(marker)).toHaveLength(1);
    expect(await stateOf(fixture.deliveryId)).toMatchObject({
      status: 'in_progress',
      attempt_count: 0,
    });

    // Nothing else may take it while the lease holds; once the lease runs out it is claimed again.
    await t.dispatcher.drainOnce();
    expect(sentFor(marker)).toHaveLength(1);
    await t.db.query(
      `update deliveries set locked_until = now() - interval '1 second' where id = $1`,
      [fixture.deliveryId],
    );
    await t.dispatcher.drainOnce();

    const requests = sentFor(marker);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.headers['webhook-id']).toBe(requests[1]!.headers['webhook-id']);
    expect(await stateOf(fixture.deliveryId)).toMatchObject({
      status: 'succeeded',
      attempt_count: 1,
    });
    const history = await t.attempts.listForDelivery(
      fixture.organizationId,
      fixture.messageId,
      fixture.endpointId,
    );
    expect(history).toHaveLength(1); // the repeated attempt overwrote its own item
    repository.recordOutcome = record;
  });

  it('ignores a stale worker that finishes an attempt another worker already recorded', async () => {
    const fixture = await seedDelivery(t.db, { url: url(), attemptCount: 2 });
    const repository = t.app.get<DeliveryRepository>(DELIVERY_REPOSITORY);
    const claimed: ClaimedDelivery = {
      deliveryId: fixture.deliveryId,
      organizationId: fixture.organizationId,
      endpointId: fixture.endpointId,
      messageId: fixture.messageId,
      attempt: 3,
      cycleBase: 0,
    };
    expect(await repository.recordOutcome(claimed, { kind: 'succeeded', statusCode: 200 })).toBe(
      true,
    );
    const late = await repository.recordOutcome(claimed, {
      kind: 'retry',
      at: new Date(Date.now() + 60_000),
      statusCode: 500,
      errorClass: 'http_5xx',
    });
    expect(late).toBe(false);
    expect(await stateOf(fixture.deliveryId)).toMatchObject({
      status: 'succeeded',
      attempt_count: 3,
    });
  });

  it('sends each delivery exactly once when several workers run at the same time', async () => {
    const second = await createTestDispatcher();
    const markers: string[] = [];
    for (let i = 0; i < 24; i += 1) {
      const marker = 'race-' + randomUUID();
      markers.push(marker);
      await seedDelivery(t.db, { url: url(), payload: { marker } });
    }
    await Promise.all([
      t.dispatcher.drainOnce(),
      second.dispatcher.drainOnce(),
      t.dispatcher.drainOnce(),
    ]);
    await Promise.all([t.dispatcher.drainOnce(), second.dispatcher.drainOnce()]);
    await second.close();
    for (const marker of markers) expect(sentFor(marker), marker).toHaveLength(1);
  });
});
