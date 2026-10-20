import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from './support/resources.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('applications', () => {
  let t: TestApp;
  let admin: Actor;
  let manager: Actor;
  let viewer: Actor;

  beforeAll(async () => {
    t = await createTestApp();
    const org = newOrganizationId();
    admin = await t.actor(org, 'ADMIN');
    manager = await t.actor(org, 'MANAGER');
    viewer = await t.actor(org, 'VIEWER');
  });
  afterAll(() => t.close());

  it('create, read, update and list, with unique live names', async () => {
    const created = await createApplication(t, admin, 'Staging');
    const read = await t
      .http()
      .get('/api/v1/applications/' + created.id)
      .set(viewer.auth)
      .expect(200);
    expect(read.body).toMatchObject({ name: 'Staging', archivedAt: null });

    await t
      .http()
      .patch('/api/v1/applications/' + created.id)
      .set(manager.auth)
      .send({ description: 'Pre-production' })
      .expect(200);
    await t
      .http()
      .post('/api/v1/applications')
      .set(admin.auth)
      .send({ name: 'staging' })
      .expect(409);

    const list = await t.http().get('/api/v1/applications').set(viewer.auth).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toContain(created.id);
    expect(list.body).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('archives idempotently, hides archived ones and frees the name', async () => {
    const app = await createApplication(t, admin, 'Temporary');
    const archive = () =>
      t
        .http()
        .post('/api/v1/applications/' + app.id + '/archive')
        .set(admin.auth)
        .expect(200);
    const first = await archive();
    const second = await archive();
    expect(second.body.archivedAt).toBe(first.body.archivedAt);

    const hidden = await t.http().get('/api/v1/applications').set(admin.auth).expect(200);
    expect(hidden.body.items.map((item: { id: string }) => item.id)).not.toContain(app.id);
    const shown = await t
      .http()
      .get('/api/v1/applications?includeArchived=true')
      .set(admin.auth)
      .expect(200);
    expect(shown.body.items.map((item: { id: string }) => item.id)).toContain(app.id);

    const reused = await createApplication(t, admin, 'Temporary');
    expect(reused.id).not.toBe(app.id);
    await t
      .http()
      .post('/api/v1/applications/' + app.id + '/restore')
      .set(admin.auth)
      .expect(409);
    await t
      .http()
      .post('/api/v1/applications/' + app.id + '/endpoints')
      .set(admin.auth)
      .send({ url: 'https://hooks.example.com/x' })
      .expect(404);
  });

  it('applies role permissions', async () => {
    await t.http().post('/api/v1/applications').set(viewer.auth).send({ name: 'No' }).expect(403);
    const app = await createApplication(t, admin, 'Roles');
    await t
      .http()
      .post('/api/v1/applications/' + app.id + '/archive')
      .set(manager.auth)
      .expect(403);
    await t.http().get('/api/v1/applications').expect(401);
  });
});
