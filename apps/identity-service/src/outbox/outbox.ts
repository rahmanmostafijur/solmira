import type { IdentityEventPayloads, IdentityEventType } from '@solmira/contracts';
import { getRequestContext } from '@solmira/service-kit';
import { v7 as uuidv7 } from 'uuid';
import type { IdentityTransaction } from '../database/database.module.js';
import { outboxEvents } from '../database/schema.js';

export interface EventMetadata {
  readonly organizationId?: string | null;
  readonly actorId?: string | null;
}

/**
 * Records an integration event in the same transaction as the change it describes: either both
 * commit or neither does. Publishing to RabbitMQ is the outbox relay's job (phase 7).
 */
export async function recordEvent<T extends IdentityEventType>(
  tx: IdentityTransaction,
  type: T,
  payload: IdentityEventPayloads[T],
  metadata: EventMetadata = {},
): Promise<void> {
  await tx.insert(outboxEvents).values({
    id: uuidv7(),
    type,
    version: 1,
    occurredAt: new Date(),
    organizationId: metadata.organizationId ?? null,
    actorId: metadata.actorId ?? null,
    correlationId: getRequestContext()?.correlationId ?? uuidv7(),
    causationId: null,
    payload,
  });
}
