import { randomUUID } from 'node:crypto';
import type { DeliveryAttemptedPayload } from '@solmira/contracts';
import type { TestApp } from './test-app.js';

export const HOUR = 3_600_000;
export const T0 = new Date('2026-10-20T00:00:00.000Z');

export interface AttemptSpec {
  readonly deliveryId?: string;
  readonly endpointId: string;
  readonly applicationId: string;
  readonly attempt?: number;
  readonly result?: DeliveryAttemptedPayload['result'];
  readonly durationMs: number;
  readonly startedAt?: Date;
}

export function attemptPayload(spec: AttemptSpec): DeliveryAttemptedPayload {
  const result = spec.result ?? 'succeeded';
  return {
    deliveryId: spec.deliveryId ?? randomUUID(),
    messageId: randomUUID(),
    endpointId: spec.endpointId,
    applicationId: spec.applicationId,
    eventType: 'order.created',
    attempt: spec.attempt ?? 1,
    result,
    statusCode: result === 'succeeded' ? 200 : 500,
    errorClass: result === 'succeeded' ? null : 'http_5xx',
    durationMs: spec.durationMs,
    startedAt: (spec.startedAt ?? new Date(T0.getTime() + HOUR)).toISOString(),
    nextAttemptAt: null,
  };
}

/** Publishes the attempts through RabbitMQ, as the relay would, and waits until they are stored. */
export async function publishAttempts(
  t: TestApp,
  organizationId: string,
  specs: readonly AttemptSpec[],
): Promise<void> {
  const before = await countAttempts(t, organizationId);
  for (const spec of specs)
    await t.publish('delivery.attempted', organizationId, attemptPayload(spec));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await countAttempts(t, organizationId)) >= before + specs.length) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The attempts were not stored in time');
}

export async function countAttempts(t: TestApp, organizationId: string): Promise<number> {
  const { rows } = await t.db.query(
    'select count(*)::int as n from delivery_attempts where organization_id = $1',
    [organizationId],
  );
  return rows[0].n;
}

/** The textbook definition (linear interpolation between closest ranks), as an independent check. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}
