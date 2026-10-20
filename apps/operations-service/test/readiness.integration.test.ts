import { assertRowLevelSecurityEnforced } from '@solmira/service-kit';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';

const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 1 });
const runtime = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });

describe('operations-service against real infrastructure', () => {
  let harness: TestApp;

  beforeAll(async () => {
    harness = await createTestApp();
  });

  afterAll(async () => {
    await harness.close();
    await owner.end();
    await runtime.end();
  });

  it('becomes ready with PostgreSQL, Redis and RabbitMQ', async () => {
    // RabbitMQ connects in the background; readiness settles within a few seconds.
    const deadline = Date.now() + 15_000;
    let response = await harness.http().get('/health/ready');
    while (response.status !== 200 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      response = await harness.http().get('/health/ready');
    }
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });

  it('runs as a role that Row Level Security applies to', async () => {
    await expect(assertRowLevelSecurityEnforced(runtime)).resolves.toBeUndefined();
  });

  it('resolves a missing tenant context to no tenant at all', async () => {
    const { rows } = await runtime.query<{ organization_id: string | null }>(
      'select app_current_organization_id() as organization_id',
    );
    expect(rows[0]?.organization_id).toBeNull();
  });

  it('keeps the outbox writable for the runtime role and not owned by it', async () => {
    const { rows } = await owner.query<{ owner: string }>(
      `select tableowner as owner from pg_tables where tablename = 'outbox_events'`,
    );
    expect(rows[0]?.owner).not.toBe(new URL(inject('appDatabaseUrl')).username);
  });
});
