import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey, createApplication, createEndpoint } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('secrets in logs', () => {
  let t: TestApp;
  let admin: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.actor(newOrganizationId(), 'ADMIN');
  });
  afterAll(() => t.close());

  it('never writes signing secrets, API keys or custom header values to the log', async () => {
    const app = await createApplication(t, admin);
    const endpoint = await createEndpoint(t, admin, app.id, {
      headers: { authorization: 'Bearer customer-token-31337' },
    });
    const key = await createApiKey(t, admin, app.id);
    const base = '/api/v1/applications/' + app.id;
    await t
      .http()
      .post(base + '/endpoints/' + endpoint.id + '/secret/reveal')
      .set(admin.auth)
      .expect(200);
    // Failing requests log too: a rejected body must not be echoed.
    await t
      .http()
      .post(base + '/endpoints')
      .set(admin.auth)
      .send({ url: 'https://10.0.0.1/x', headers: { authorization: 'Bearer leaked-token-777' } })
      .expect(400);
    await t
      .http()
      .get(base + '/api-keys')
      .set({ Authorization: 'Bearer ' + key.key })
      .expect(401);

    const output = t.logs();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('"statusCode":400');
    for (const secret of [
      endpoint.signingSecret,
      key.key,
      'customer-token-31337',
      'leaked-token-777',
    ])
      expect(output).not.toContain(secret);
    expect(output).not.toMatch(/whsec_[A-Za-z0-9+/]{20}/);
    expect(output).not.toMatch(/slm_[A-Za-z0-9_-]{20}/);
  });
});
