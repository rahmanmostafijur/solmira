import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './support/test-server.js';
import { seedDelivery } from './support/seed.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

describe('a signing secret that cannot be decrypted', () => {
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

  it('waits and counts no attempt, instead of failing the delivery or sending unsigned', async () => {
    const before = receiver.requests.length;
    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port + '/h' });
    // The secret was wrapped by a key this worker does not have, as when the key service is
    // unavailable or the wrong key is configured.
    await t.db.query(
      `update endpoint_secrets set key_id = 'some-other-key' where endpoint_id = $1`,
      [fixture.endpointId],
    );

    await t.dispatcher.drainOnce();

    expect(receiver.requests.length).toBe(before);
    const { rows } = await t.db.query(
      `select status, attempt_count, locked_until, next_attempt_at > now() + interval '20 seconds' as waits
         from deliveries where id = $1`,
      [fixture.deliveryId],
    );
    expect(rows[0]).toMatchObject({
      status: 'pending',
      attempt_count: 0,
      locked_until: null,
      waits: true,
    });
  });

  it('delivers once the secret can be read again', async () => {
    const before = receiver.requests.length;
    const fixture = await seedDelivery(t.db, { url: 'http://hooks.test:' + receiver.port + '/h' });
    await t.db.query(
      `update endpoint_secrets set key_id = 'some-other-key' where endpoint_id = $1`,
      [fixture.endpointId],
    );
    await t.dispatcher.drainOnce();
    expect(receiver.requests.length).toBe(before);

    await t.db.query(`update endpoint_secrets set key_id = 'local-1' where endpoint_id = $1`, [
      fixture.endpointId,
    ]);
    await t.db.query(`update deliveries set next_attempt_at = now() where id = $1`, [
      fixture.deliveryId,
    ]);
    await t.dispatcher.drainOnce();

    expect(receiver.requests.length).toBe(before + 1);
    const { rows } = await t.db.query('select status from deliveries where id = $1', [
      fixture.deliveryId,
    ]);
    expect(rows[0].status).toBe('succeeded');
  });
});
