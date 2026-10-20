import { eventEnvelopeSchema } from '@solmira/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FanOutService } from '../src/fan-out/fan-out.service.js';
import { sendMessage } from './support/ingestion.js';
import {
  createApiKey,
  createApplication,
  createEndpoint,
  createEventType,
} from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('fan-out', () => {
  let t: TestApp;
  let admin: Actor;
  let appId: string;
  let key: string;
  let invoicePaid: { id: string; name: string };
  let userCreated: { id: string; name: string };
  const endpoints: Record<string, string> = {};

  const base = () => '/api/v1/applications/' + appId + '/endpoints/';
  const deliveriesOf = async (messageId: string) =>
    (
      await t.db.query(
        'select endpoint_id, status, attempt_count from deliveries where message_id = $1',
        [messageId],
      )
    ).rows as { endpoint_id: string; status: string; attempt_count: number }[];
  const waitForDeliveries = async (messageId: string, count: number) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const rows = await deliveriesOf(messageId);
      if (rows.length >= count) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return deliveriesOf(messageId);
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    appId = (await createApplication(t, admin, 'Fan-out')).id;
    key = (await createApiKey(t, admin, appId)).key;
    invoicePaid = await createEventType(t, admin, 'invoice.paid');
    userCreated = await createEventType(t, admin, 'user.created');
    endpoints.all = (await createEndpoint(t, admin, appId)).id; // no subscriptions: everything
    endpoints.invoices = (
      await createEndpoint(t, admin, appId, { eventTypeIds: [invoicePaid.id] })
    ).id;
    endpoints.users = (
      await createEndpoint(t, admin, appId, { eventTypeIds: [userCreated.id] })
    ).id;
    endpoints.both = (
      await createEndpoint(t, admin, appId, { eventTypeIds: [invoicePaid.id, userCreated.id] })
    ).id;
    endpoints.disabled = (await createEndpoint(t, admin, appId, { enabled: false })).id;
    endpoints.archived = (await createEndpoint(t, admin, appId)).id;
    await t
      .http()
      .delete(base() + endpoints.archived)
      .set(admin.auth)
      .expect(204);
  });
  afterAll(() => t.close());

  it('creates one pending delivery per subscribed, enabled, live endpoint', async () => {
    const response = await sendMessage(t, appId, key, {
      eventType: invoicePaid.name,
      payload: { n: 1 },
    }).expect(202);
    const rows = await waitForDeliveries(response.body.id, 3);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const final = await deliveriesOf(response.body.id);
    expect(final.map((row) => row.endpoint_id).sort()).toEqual(
      [endpoints.all, endpoints.invoices, endpoints.both].sort(),
    );
    expect(rows.every((row) => row.status === 'pending' && row.attempt_count === 0)).toBe(true);
  });

  it('routes by event type', async () => {
    const response = await sendMessage(t, appId, key, {
      eventType: userCreated.name,
      payload: {},
    }).expect(202);
    await waitForDeliveries(response.body.id, 3);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await deliveriesOf(response.body.id)).map((row) => row.endpoint_id).sort()).toEqual(
      [endpoints.all, endpoints.users, endpoints.both].sort(),
    );
  });

  it('ignores endpoints of other applications and other organizations', async () => {
    const otherApp = await createApplication(t, admin, 'Elsewhere');
    await createEndpoint(t, admin, otherApp.id);
    const stranger = await t.actor(newOrganizationId(), 'OWNER');
    const strangerApp = await createApplication(t, stranger, 'Stranger');
    await createEndpoint(t, stranger, strangerApp.id);
    const response = await sendMessage(t, appId, key, {
      eventType: invoicePaid.name,
      payload: {},
    }).expect(202);
    await waitForDeliveries(response.body.id, 3);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await deliveriesOf(response.body.id)).toHaveLength(3);
  });

  it('applies a delivered event once even when it is handled again', async () => {
    const response = await sendMessage(t, appId, key, {
      eventType: invoicePaid.name,
      payload: { again: true },
    }).expect(202);
    await waitForDeliveries(response.body.id, 3);
    const { rows } = await t.db.query(
      `select id, type, version, occurred_at, organization_id, actor_id, correlation_id, causation_id, payload
         from outbox_events where type = 'message.created' and payload->>'messageId' = $1`,
      [response.body.id],
    );
    const row = rows[0];
    const envelope = eventEnvelopeSchema.parse({
      eventId: row.id,
      type: row.type,
      version: row.version,
      occurredAt: row.occurred_at.toISOString(),
      organizationId: row.organization_id,
      actorId: row.actor_id,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      payload: row.payload,
    });
    const fanOut = t.app.get(FanOutService);
    await fanOut.handle(envelope);
    await fanOut.handle(envelope);
    expect(await deliveriesOf(response.body.id)).toHaveLength(3);
    const claims = await t.db.query(
      'select count(*)::int as n from processed_events where event_id = $1',
      [row.id],
    );
    expect(claims.rows[0].n).toBe(1);
  });

  it('refuses an event that names no organization or message', async () => {
    const fanOut = t.app.get(FanOutService);
    const base = {
      eventId: '0190b0a0-7c5e-7000-8000-0000000000aa',
      type: 'message.created',
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId: null,
      correlationId: 'c',
      causationId: null,
    };
    await expect(
      fanOut.handle({ ...base, organizationId: null, payload: { messageId: 'x' } }),
    ).rejects.toThrow();
    await expect(
      fanOut.handle({ ...base, organizationId: admin.organizationId, payload: {} }),
    ).rejects.toThrow();
  });

  it('marks every published event as published after relaying', async () => {
    const response = await sendMessage(t, appId, key, {
      eventType: invoicePaid.name,
      payload: {},
    }).expect(202);
    const deadline = Date.now() + 15_000;
    let published = false;
    while (!published && Date.now() < deadline) {
      const { rows } = await t.db.query(
        `select published_at from outbox_events where payload->>'messageId' = $1`,
        [response.body.id],
      );
      published = rows[0]?.published_at !== null && rows[0]?.published_at !== undefined;
      if (!published) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(published).toBe(true);
  });
});
