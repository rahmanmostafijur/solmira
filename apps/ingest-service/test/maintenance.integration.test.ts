import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../src/maintenance.service.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('outbox maintenance', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ OUTBOX_RETENTION_DAYS: '7' });
  });
  afterAll(() => t.close());

  async function insertEvent(publishedAgo: string | null): Promise<string> {
    const id: string = randomUUID();
    await t.db.query(
      `insert into outbox_events (id, type, version, occurred_at, correlation_id, payload, published_at)
       values ($1, 'maintenance.test', 1, now(), 'c', '{}',
               case when $2::text is null then null else now() - $2::interval end)`,
      [id, publishedAgo],
    );
    return id;
  }

  it('removes published events older than the retention period and keeps everything else', async () => {
    const old = await insertEvent('10 days');
    const recent = await insertEvent('1 day');
    const unpublished = await insertEvent(null);
    // Keep the relay from publishing the unpublished one while the pass runs.
    await t.db.query(`update outbox_events set type = 'maintenance.hold' where id = $1`, [
      unpublished,
    ]);

    const result = await t.app.get(MaintenanceService).runOnce();
    expect(result.outboxEvents).toBeGreaterThanOrEqual(1);

    const remaining = await t.db.query('select id from outbox_events where id = any($1)', [
      [old, recent, unpublished],
    ]);
    const ids = remaining.rows.map((row) => row.id);
    expect(ids).not.toContain(old);
    expect(ids).toContain(recent);
    expect(ids).toContain(unpublished);
  });
});
