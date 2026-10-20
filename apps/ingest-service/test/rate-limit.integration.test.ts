import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendMessage } from './support/ingestion.js';
import { createApiKey, createApplication, createEventType } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('ingestion rate limiting', () => {
  let t: TestApp;
  let admin: Actor;
  let appId: string;
  let eventType: string;

  beforeAll(async () => {
    t = await createTestApp({ INGEST_RATE_LIMIT_PER_MINUTE: '3' });
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    appId = (await createApplication(t, admin, 'Rate limited')).id;
    eventType = (await createEventType(t, admin, 'tick')).name;
  });
  afterAll(() => t.close());

  const body = () => ({ eventType, payload: {} });

  it('answers 429 with Retry-After once a key exceeds its budget, and only for that key', async () => {
    const busy = (await createApiKey(t, admin, appId)).key;
    const quiet = (await createApiKey(t, admin, appId)).key;
    for (let i = 0; i < 3; i += 1) await sendMessage(t, appId, busy, body()).expect(202);

    const limited = await sendMessage(t, appId, busy, body()).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);

    await sendMessage(t, appId, quiet, body()).expect(202);
  });

  it('does not count requests that fail authentication against any key', async () => {
    const key = (await createApiKey(t, admin, appId)).key;
    for (let i = 0; i < 6; i += 1)
      await sendMessage(t, appId, 'slm_' + 'B'.repeat(43), body()).expect(401);
    await sendMessage(t, appId, key, body()).expect(202);
  });

  it('stores nothing for a request that was limited', async () => {
    const key = (await createApiKey(t, admin, appId)).key;
    for (let i = 0; i < 3; i += 1) await sendMessage(t, appId, key, body()).expect(202);
    const before = await t.db.query(
      'select count(*)::int as n from messages where application_id = $1',
      [appId],
    );
    await sendMessage(t, appId, key, body()).expect(429);
    const after = await t.db.query(
      'select count(*)::int as n from messages where application_id = $1',
      [appId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
