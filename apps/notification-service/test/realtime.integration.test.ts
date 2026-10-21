import { randomUUID } from 'node:crypto';
import { REVOCATION_STORE, type RevocationStore } from '@solmira/service-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedClient, connectionError } from './support/feed-client.js';
import { createTestApp, newOrganizationId, type TestApp } from './support/test-app.js';

const attempt = (overrides: Record<string, unknown> = {}) => ({
  deliveryId: randomUUID(),
  messageId: randomUUID(),
  endpointId: randomUUID(),
  applicationId: randomUUID(),
  eventType: 'order.created',
  attempt: 1,
  result: 'succeeded',
  statusCode: 200,
  errorClass: null,
  durationMs: 12,
  startedAt: '2026-10-21T10:00:00.000Z',
  nextAttemptAt: null,
  ...overrides,
});

describe('realtime delivery feed', () => {
  let t: TestApp;
  let url: string;
  const clients: FeedClient[] = [];

  beforeAll(async () => {
    t = await createTestApp({ REALTIME_MAX_CONNECTIONS_PER_ORGANIZATION: '3' });
    url = await t.listen();
  });
  afterAll(async () => {
    clients.forEach((client) => client.close());
    await t.close();
  });

  /** Connects, authenticates, and waits until the feed's queue is bound, so no event is missed. */
  async function connectAs(
    organizationId: string,
    options: Parameters<TestApp['token']>[0] = { organizationId },
  ) {
    const client = await FeedClient.open(url);
    clients.push(client);
    client.authenticate(await t.token(options));
    await client.waitFor((frame) => frame.type === 'ready');
    const probe = randomUUID();
    for (let i = 0; i < 100; i += 1) {
      await t.publish('message.created', organizationId, {
        messageId: probe,
        applicationId: randomUUID(),
        eventTypeId: randomUUID(),
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (client.frames.some((f) => f.data?.messageId === probe)) break;
    }
    client.frames.length = 0;
    return client;
  }

  it('streams the attempts of the organization the token belongs to', async () => {
    const org = newOrganizationId();
    const client = await connectAs(org);
    const payload = attempt();

    await t.publish('delivery.attempted', org, { ...payload, url: 'https://hooks.example/x' });

    const frame = await client.waitFor((f) => f.type === 'delivery.attempted');
    expect(frame.data).toEqual(payload);
    expect(JSON.stringify(client.frames)).not.toContain('hooks.example');
  });

  it("never delivers one organization's events to another organization's clients", async () => {
    const orgA = newOrganizationId();
    const orgB = newOrganizationId();
    const a = await connectAs(orgA);
    const b = await connectAs(orgB);
    const forA = attempt();
    const forB = attempt();

    await t.publish('delivery.attempted', orgA, forA);
    await t.publish('delivery.attempted', orgB, forB);
    await a.waitFor((f) => f.data?.deliveryId === forA.deliveryId);
    await b.waitFor((f) => f.data?.deliveryId === forB.deliveryId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(a.frames.map((f) => f.data?.deliveryId)).toEqual([forA.deliveryId]);
    expect(b.frames.map((f) => f.data?.deliveryId)).toEqual([forB.deliveryId]);
    expect(JSON.stringify(a.frames)).not.toContain(forB.deliveryId);
    expect(JSON.stringify(b.frames)).not.toContain(forA.deliveryId);
  });

  it('does not let a client choose its tenant: only the token decides', async () => {
    const orgA = newOrganizationId();
    const orgB = newOrganizationId();
    const client = await connectAs(orgA);
    const foreign = attempt();

    // Nothing the client sends after authenticating can change what it receives.
    client.sendRaw(JSON.stringify({ type: 'subscribe', organizationId: orgB }));
    await t.publish('delivery.attempted', orgB, foreign);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await client.closed).toMatchObject({ code: 4400 });
    expect(JSON.stringify(client.frames)).not.toContain(foreign.deliveryId);
  });

  it('closes a client that never authenticates', async () => {
    const client = await FeedClient.open(url);
    clients.push(client);
    expect(await client.closed).toMatchObject({ code: 4401 });
  }, 15_000);

  it('closes a client that sends something other than an auth frame first', async () => {
    const client = await FeedClient.open(url);
    clients.push(client);
    client.sendRaw('hello');
    expect(await client.closed).toMatchObject({ code: 4400 });
  });

  it.each([
    ['a token signed by an unknown key', { key: 'untrusted' as const }],
    ['an expired token', { expiresInSeconds: -60 }],
  ])('refuses %s', async (_name, extra) => {
    const client = await FeedClient.open(url);
    clients.push(client);
    client.authenticate(await t.token({ organizationId: newOrganizationId(), ...extra }));
    expect(await client.closed).toMatchObject({ code: 4401 });
    expect(client.frames).toEqual([]);
  });

  it('refuses a token that has no organization or lacks messages.read', async () => {
    const withoutOrg = await FeedClient.open(url);
    clients.push(withoutOrg);
    withoutOrg.authenticate(await t.token({ organizationId: null }));
    expect(await withoutOrg.closed).toMatchObject({ code: 4403 });

    const withoutPermission = await FeedClient.open(url);
    clients.push(withoutPermission);
    withoutPermission.authenticate(
      await t.token({ organizationId: newOrganizationId(), permissions: ['analytics.read'] }),
    );
    expect(await withoutPermission.closed).toMatchObject({ code: 4403 });
  });

  it('refuses a token whose session was revoked', async () => {
    const sessionId = randomUUID();
    await t.app.get<RevocationStore>(REVOCATION_STORE).revokeSession(sessionId);
    const client = await FeedClient.open(url);
    clients.push(client);
    client.authenticate(await t.token({ organizationId: newOrganizationId(), sessionId }));
    expect(await client.closed).toMatchObject({ code: 4401 });
  });

  it('closes the connection when its token expires', async () => {
    const org = newOrganizationId();
    const client = await connectAs(org, { organizationId: org, expiresInSeconds: 3 });
    expect(await client.closed).toMatchObject({ code: 4401, reason: 'Token expired' });
  }, 15_000);

  it('limits the connections of one organization without affecting another', async () => {
    const org = newOrganizationId();
    for (let i = 0; i < 3; i += 1) await connectAs(org);

    const extra = await FeedClient.open(url);
    clients.push(extra);
    extra.authenticate(await t.token({ organizationId: org }));
    expect(await extra.closed).toMatchObject({ code: 1013 });

    const other = await connectAs(newOrganizationId());
    expect(other.frames).toEqual([]);
  });

  it('refuses connections to any other path', async () => {
    const wrong = url.replace('/ws/v1/deliveries', '/ws/v1/other');
    expect((await connectionError(wrong)).message).not.toBe('connected');
  });
});
