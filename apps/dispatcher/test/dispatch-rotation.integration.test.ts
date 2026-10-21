import { verifyWebhook } from '@solmira/webhooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDelivery } from './support/seed.js';
import { startServer, type TestServer } from './support/test-server.js';
import { createTestDispatcher, type TestDispatcher } from './support/test-app.js';

describe('signing during and after a rotation window', () => {
  let t: TestDispatcher;
  let receiver: TestServer;

  beforeAll(async () => {
    t = await createTestDispatcher();
    receiver = await startServer((_request, response) => response.writeHead(200).end());
  });
  afterAll(async () => {
    await receiver.close();
    await t.close();
  });

  it('signs with both secrets while the previous one is valid and only the new one afterwards', async () => {
    const url = 'http://hooks.test:' + receiver.port;
    const during = await seedDelivery(t.db, {
      url,
      previousSecret: true,
      payload: { phase: 'during' },
    });
    const after = await seedDelivery(t.db, {
      url,
      previousSecret: true,
      payload: { phase: 'after' },
    });
    await t.db.query(
      `update endpoint_secrets set expires_at = now() - interval '1 second' where endpoint_id = $1 and status = 'previous'`,
      [after.endpointId],
    );
    await t.dispatcher.drainOnce();

    const find = (phase: string) => receiver.requests.find((r) => r.body.includes(phase))!;
    const signatures = (phase: string) =>
      String(find(phase).headers['webhook-signature']).split(' ');
    expect(signatures('during')).toHaveLength(2);
    expect(signatures('after')).toHaveLength(1);

    const verify = (phase: string, secret: string) =>
      verifyWebhook({ headers: find(phase).headers, body: find(phase).body, secrets: [secret] });
    expect(() => verify('during', during.secret)).not.toThrow();
    expect(() => verify('during', during.previousSecret!)).not.toThrow();
    expect(() => verify('after', after.secret)).not.toThrow();
    expect(() => verify('after', after.previousSecret!)).toThrow('no_matching_signature');
  });
});
