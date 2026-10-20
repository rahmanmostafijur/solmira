import type { Actor, TestApp } from './test-app.js';

/** Small helpers that create resources over HTTP and return their bodies. */
export async function createApplication(harness: TestApp, actor: Actor, name = 'Production') {
  const response = await harness
    .http()
    .post('/api/v1/applications')
    .set(actor.auth)
    .send({ name })
    .expect(201);
  return response.body as { id: string; name: string };
}

export async function createEventType(harness: TestApp, actor: Actor, name: string) {
  const response = await harness
    .http()
    .post('/api/v1/event-types')
    .set(actor.auth)
    .send({ name })
    .expect(201);
  return response.body as { id: string; name: string };
}

export async function createEndpoint(
  harness: TestApp,
  actor: Actor,
  applicationId: string,
  body: Record<string, unknown> = {},
) {
  const response = await harness
    .http()
    .post('/api/v1/applications/' + applicationId + '/endpoints')
    .set(actor.auth)
    .send({ url: 'https://hooks.example.com/webhooks', ...body })
    .expect(201);
  return response.body as { id: string; signingSecret: string; url: string };
}

export async function createApiKey(
  harness: TestApp,
  actor: Actor,
  applicationId: string,
  body: Record<string, unknown> = {},
) {
  const response = await harness
    .http()
    .post('/api/v1/applications/' + applicationId + '/api-keys')
    .set(actor.auth)
    .send({ name: 'ci', ...body })
    .expect(201);
  return response.body as { id: string; key: string; prefix: string };
}
