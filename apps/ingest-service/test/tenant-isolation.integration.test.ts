import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApiKey,
  createApplication,
  createEndpoint,
  createEventType,
} from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Organization B tries everything on organization A's resources over HTTP. Every attempt must
 * answer as if the resource did not exist, and nothing of A may change.
 */
describe('cross-tenant access over HTTP', () => {
  let t: TestApp;
  let a: Actor;
  let b: Actor;
  let app: { id: string };
  let eventType: { id: string };
  let endpoint: { id: string; signingSecret: string };
  let apiKey: { id: string };

  beforeAll(async () => {
    t = await createTestApp();
    a = await t.actor(newOrganizationId(), 'OWNER');
    b = await t.actor(newOrganizationId(), 'OWNER');
    app = await createApplication(t, a, 'Alpha');
    eventType = await createEventType(t, a, 'alpha.event');
    endpoint = await createEndpoint(t, a, app.id, { eventTypeIds: [eventType.id] });
    apiKey = await createApiKey(t, a, app.id);
  });
  afterAll(() => t.close());

  const appPath = () => '/api/v1/applications/' + app.id;
  const endpointPath = () => appPath() + '/endpoints/' + endpoint.id;

  it('applications: read, update, archive and restore answer 404', async () => {
    await t.http().get(appPath()).set(b.auth).expect(404);
    await t.http().patch(appPath()).set(b.auth).send({ name: 'Hijacked' }).expect(404);
    await t
      .http()
      .post(appPath() + '/archive')
      .set(b.auth)
      .expect(404);
    await t
      .http()
      .post(appPath() + '/restore')
      .set(b.auth)
      .expect(404);
    const stillThere = await t.http().get(appPath()).set(a.auth).expect(200);
    expect(stillThere.body).toMatchObject({ name: 'Alpha', archivedAt: null });
  });

  it('applications: lists never include another organization', async () => {
    const list = await t
      .http()
      .get('/api/v1/applications?includeArchived=true')
      .set(b.auth)
      .expect(200);
    expect(list.body.items).toEqual([]);
    expect(list.body.total).toBe(0);
  });

  it('event types: read, update and archive answer 404; lists stay empty', async () => {
    const path = '/api/v1/event-types/' + eventType.id;
    await t.http().get(path).set(b.auth).expect(404);
    await t.http().patch(path).set(b.auth).send({ description: 'x' }).expect(404);
    await t
      .http()
      .post(path + '/archive')
      .set(b.auth)
      .expect(404);
    const list = await t
      .http()
      .get('/api/v1/event-types?includeArchived=true')
      .set(b.auth)
      .expect(200);
    expect(list.body.items).toEqual([]);
  });

  it('event types: the same name can exist in both organizations', async () => {
    await createEventType(t, b, 'alpha.event');
  });

  it('endpoints: every operation on the other application or endpoint answers 404', async () => {
    await t
      .http()
      .get(appPath() + '/endpoints')
      .set(b.auth)
      .expect(404);
    await t
      .http()
      .post(appPath() + '/endpoints')
      .set(b.auth)
      .send({ url: 'https://hooks.example.com/b' })
      .expect(404);
    await t.http().get(endpointPath()).set(b.auth).expect(404);
    await t.http().patch(endpointPath()).set(b.auth).send({ enabled: false }).expect(404);
    await t.http().delete(endpointPath()).set(b.auth).expect(404);
    const intact = await t.http().get(endpointPath()).set(a.auth).expect(200);
    expect(intact.body).toMatchObject({ enabled: true, archivedAt: null });
  });

  it('endpoints: the signing secret of another organization cannot be revealed', async () => {
    const response = await t
      .http()
      .post(endpointPath() + '/secret/reveal')
      .set(b.auth)
      .expect(404);
    expect(JSON.stringify(response.body)).not.toContain(endpoint.signingSecret);
  });

  it('endpoints: an endpoint cannot subscribe to another organization event type', async () => {
    const bApp = await createApplication(t, b, 'Bravo');
    const response = await t
      .http()
      .post('/api/v1/applications/' + bApp.id + '/endpoints')
      .set(b.auth)
      .send({ url: 'https://hooks.example.com/b', eventTypeIds: [eventType.id] })
      .expect(400);
    expect(response.body.error.details[0].path).toBe('eventTypeIds.0');
  });

  it('API keys: listing, creating and revoking across organizations answers 404', async () => {
    await t
      .http()
      .get(appPath() + '/api-keys')
      .set(b.auth)
      .expect(404);
    await t
      .http()
      .post(appPath() + '/api-keys')
      .set(b.auth)
      .send({ name: 'x' })
      .expect(404);
    await t
      .http()
      .delete(appPath() + '/api-keys/' + apiKey.id)
      .set(b.auth)
      .expect(404);
    const keys = await t
      .http()
      .get(appPath() + '/api-keys')
      .set(a.auth)
      .expect(200);
    expect(keys.body.items[0].revokedAt).toBeNull();
  });

  it('an application of one organization is not found by another through any path', async () => {
    const bApp = await createApplication(t, b, 'Bravo 2');
    await t
      .http()
      .get('/api/v1/applications/' + bApp.id)
      .set(a.auth)
      .expect(404);
  });
});
