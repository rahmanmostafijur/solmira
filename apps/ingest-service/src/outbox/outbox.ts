import type { IngestEventPayloads, IngestEventType } from '@solmira/contracts';
import { getRequestContext, type TenantAuthContext } from '@solmira/service-kit';
import { v7 as uuidv7 } from 'uuid';
import type { IngestTransaction } from '../database/database.module.js';
import { outboxEvents } from '../database/schema.js';

/**
 * Records an administrative event in the same transaction as the change: both commit or neither
 * does. Payloads carry ids and field names only, never secrets, keys or URLs. Publishing to
 * RabbitMQ is the relay's job (Phase 5).
 */
export async function recordEvent<T extends IngestEventType>(
  tx: IngestTransaction,
  auth: TenantAuthContext,
  type: T,
  payload: IngestEventPayloads[T],
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    type,
    version: 1,
    occurredAt: new Date(),
    organizationId: auth.organizationId,
    actorId: auth.userId,
    correlationId: getRequestContext()?.correlationId ?? uuidv7(),
    causationId: null,
    payload,
  });
}
