import { MetricsRegistry } from '@solmira/service-kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiKey, createApplication, createEventType } from './support/resources.js';
import { sendMessage } from './support/ingestion.js';
import { createTestApp, newOrganizationId, type TestApp } from './support/test-app.js';

describe('ingest metrics (ADR-0039)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ METRICS_ENABLED: 'true', INGEST_RATE_LIMIT_PER_MINUTE: '4' });
  });
  afterAll(() => t.close());

  async function flushed(): Promise<Record<string, unknown>[]> {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await t.app.get(MetricsRegistry).flush();
    } finally {
      spy.mockRestore();
    }
    return written.flatMap((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line.startsWith('{"_aws"'))
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
  }

  it('counts accepted, rejected and rate limited messages and reports the outbox', async () => {
    const admin = await t.actor(newOrganizationId(), 'ADMIN');
    const appId = (await createApplication(t, admin, 'Metrics')).id;
    const eventType = (await createEventType(t, admin, 'invoice.paid')).name;
    const { key } = await createApiKey(t, admin, appId);
    await flushed();

    await sendMessage(t, appId, key, { eventType, payload: { n: 1 } }).expect(202);
    await sendMessage(t, appId, key, { eventType, payload: { n: 2 } }).expect(202);
    await sendMessage(t, appId, key, { eventType: 'no.such.type', payload: {} }).expect(422);
    await sendMessage(t, appId, key, { eventType, payload: { n: 3 } }).expect(202);
    await sendMessage(t, appId, key, { eventType, payload: { n: 4 } }).expect(429);

    const lines = await flushed();
    const accepted = lines.find((line) => 'MessagesAccepted' in line);
    expect(accepted?.MessagesAccepted).toBe(3);
    const rejected = lines.find((line) => line.Reason === 'UNKNOWN_EVENT_TYPE');
    expect(rejected?.MessagesRejected).toBe(1);
    expect(lines.find((line) => 'IngestRateLimited' in line)?.IngestRateLimited).toBe(1);

    const outbox = lines.find((line) => 'OutboxUnpublished' in line)!;
    expect(typeof outbox.OutboxUnpublished).toBe('number');
    expect(typeof outbox.OutboxOldestAge).toBe('number');
  });
});
