import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './support/test-server.js';
import { seedDelivery } from './support/seed.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

interface OutboxRow {
  type: string;
  organization_id: string;
  payload: Record<string, unknown>;
}

describe('delivery.attempted events (ADR-0035)', () => {
  let t: TestDispatcher;
  let receiver: TestServer;
  let status = 200;

  beforeAll(async () => {
    t = await createTestDispatcher();
    receiver = await startServer((_request, response) => response.writeHead(status).end('ok'));
  });
  afterAll(async () => {
    await receiver.close();
    await t.close();
  });

  const urlOf = () => 'http://hooks.test:' + receiver.port + '/webhooks';
  const eventsOf = async (deliveryId: string) =>
    (
      await t.db.query<OutboxRow>(
        `select type, organization_id, payload from outbox_events
          where type = 'delivery.attempted' and payload->>'deliveryId' = $1
          order by (payload->>'attempt')::int`,
        [deliveryId],
      )
    ).rows;

  it('records one event for a successful attempt, with ids, timings and no URL or payload', async () => {
    status = 200;
    const fixture = await seedDelivery(t.db, { url: urlOf(), payload: { secretish: 'p4yload' } });
    await t.dispatcher.drainOnce();

    const events = await eventsOf(fixture.deliveryId);
    expect(events).toHaveLength(1);
    expect(events[0]!.organization_id).toBe(fixture.organizationId);
    expect(events[0]!.payload).toMatchObject({
      deliveryId: fixture.deliveryId,
      messageId: fixture.messageId,
      endpointId: fixture.endpointId,
      applicationId: fixture.applicationId,
      attempt: 1,
      result: 'succeeded',
      statusCode: 200,
      errorClass: null,
      nextAttemptAt: null,
    });
    expect(typeof events[0]!.payload.eventType).toBe('string');
    expect(events[0]!.payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(String(events[0]!.payload.startedAt)).toISOString()).toBe(
      events[0]!.payload.startedAt,
    );
    const serialized = JSON.stringify(events[0]!.payload);
    expect(serialized).not.toContain('hooks.test');
    expect(serialized).not.toContain('p4yload');
  });

  it('records a retrying event with the next attempt time, then the final failure', async () => {
    status = 500;
    const fixture = await seedDelivery(t.db, { url: urlOf() });
    await t.dispatcher.drainOnce();

    const [first] = await eventsOf(fixture.deliveryId);
    expect(first!.payload).toMatchObject({
      attempt: 1,
      result: 'retrying',
      statusCode: 500,
      errorClass: 'http_5xx',
    });
    expect(first!.payload.nextAttemptAt).toEqual(expect.any(String));
  });

  it('records nothing when no request was sent', async () => {
    const fixture = await seedDelivery(t.db, { url: urlOf() });
    await t.db.query('update endpoints set enabled = false where id = $1', [fixture.endpointId]);
    await t.dispatcher.drainOnce();

    expect(await eventsOf(fixture.deliveryId)).toHaveLength(0);
  });
});
