import type { OperationsEventPayloads, OperationsEventType } from '@solmira/contracts';
import { getRequestContext, type TenantAuthContext } from '@solmira/service-kit';
import { v7 as uuidv7 } from 'uuid';
import type { OperationsTransaction } from '../database/database.module.js';
import { outboxEvents } from '../database/schema.js';

/**
 * Records an operations event in the same transaction as the change: both commit or neither does.
 * Publishing to RabbitMQ is the outbox relay's job (phase 7); until then the rows accumulate
 * as a durable, ordered record of master-data changes.
 */
export async function recordEvent<T extends OperationsEventType>(
  tx: OperationsTransaction,
  auth: TenantAuthContext,
  type: T,
  payload: OperationsEventPayloads[T],
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
