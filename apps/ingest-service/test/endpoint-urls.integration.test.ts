import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication, createEndpoint } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('endpoint URL validation (SSRF defense at creation)', () => {
  let t: TestApp;
  let admin: Actor;
  let appId: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    appId = (await createApplication(t, admin)).id;
    t.dns.set('internal-looking.example.com', '10.0.0.7');
    t.dns.set('metadata.example.com', '169.254.169.254');
    t.dns.set('mixed.example.com', '93.184.216.34', '127.0.0.1');
    t.dns.set('v6.example.com', '2606:4700:4700::1111');
  });
  afterAll(() => t.close());

  const create = (url: string) =>
    t
      .http()
      .post('/api/v1/applications/' + appId + '/endpoints')
      .set(admin.auth)
      .send({ url });

  it.each([
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.1.2.3/hook',
    'https://192.168.1.10/hook',
    'https://[::1]/hook',
    'https://[::ffff:169.254.169.254]/hook',
    'https://2130706433/hook',
    'https://0x7f.0.0.1/hook',
    'https://localhost/hook',
    'https://service.internal/hook',
    'https://user:secret@hooks.example.com/hook',
    'ftp://hooks.example.com/hook',
    'not a url',
  ])('rejects %s', async (url) => {
    const response = await create(url).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].path).toBe('url');
  });

  it.each(['internal-looking.example.com', 'metadata.example.com', 'mixed.example.com'])(
    'rejects %s because its address is not public',
    async (host) => {
      const response = await create('https://' + host + '/hook').expect(400);
      expect(response.body.error.details[0].message).toContain('non-public');
      expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.7|169\.254|127\.0\.0\.1/);
    },
  );

  it('rejects a host that does not resolve', async () => {
    await create('https://unknown.example.com/hook').expect(400);
  });

  it('accepts hosts that resolve to public IPv4 and IPv6 addresses', async () => {
    await create('https://hooks.example.com/hook').expect(201);
    await create('https://v6.example.com/hook').expect(201);
  });

  it('applies the same rules when an endpoint URL is changed', async () => {
    const endpoint = await createEndpoint(t, admin, appId);
    const url = '/api/v1/applications/' + appId + '/endpoints/' + endpoint.id;
    await t.http().patch(url).set(admin.auth).send({ url: 'https://10.0.0.1/x' }).expect(400);
    await t.http().patch(url).set(admin.auth).send({ url: 'https://v6.example.com/y' }).expect(200);
  });
});
