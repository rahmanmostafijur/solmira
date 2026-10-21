import { Inject, Injectable } from '@nestjs/common';
import { TEST_EVENT_TYPE, type TestSendResult } from '@solmira/contracts';
import { ConflictError, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { findApplication } from '../applications/applications.service.js';
import { Database } from '../database/database.module.js';
import { deliveries, eventTypes, messages } from '../database/schema.js';
import { findEndpoint } from '../endpoints/endpoint-views.js';
import { recordEvent } from '../outbox/outbox.js';

/**
 * Sends one test event to one endpoint (ADR-0034). The message uses the platform's own event type
 * and its delivery is created directly, so no fan-out reaches the application's other endpoints.
 */
@Injectable()
export class TestSendService {
  constructor(@Inject(Database) private readonly database: Database) {}

  send(
    auth: TenantAuthContext,
    applicationId: string,
    endpointId: string,
  ): Promise<TestSendResult> {
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      const endpoint = await findEndpoint(tx, auth, applicationId, endpointId, { live: true });
      if (!endpoint.enabled) throw new ConflictError('The endpoint is disabled; enable it first');

      await tx
        .insert(eventTypes)
        .values({
          id: uuidv7(),
          organizationId: auth.organizationId,
          name: TEST_EVENT_TYPE,
          description: 'Used by the console to send a test event to one endpoint.',
        })
        .onConflictDoNothing();
      const [eventType] = await tx
        .select({ id: eventTypes.id })
        .from(eventTypes)
        .where(
          and(
            eq(eventTypes.organizationId, auth.organizationId),
            eq(eventTypes.name, TEST_EVENT_TYPE),
          ),
        );

      const messageId = uuidv7();
      const payload = {
        type: TEST_EVENT_TYPE,
        timestamp: new Date().toISOString(),
        message: 'This is a test event sent from the Solmira console.',
      };
      await tx.insert(messages).values({
        id: messageId,
        organizationId: auth.organizationId,
        applicationId,
        eventTypeId: eventType!.id,
        payload,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
        idempotencyKey: 'test-' + messageId,
      });
      const deliveryId = uuidv7();
      await tx.insert(deliveries).values({
        id: deliveryId,
        organizationId: auth.organizationId,
        applicationId,
        messageId,
        endpointId,
      });
      await recordEvent(tx, auth, 'endpoint.test_sent', { endpointId, applicationId, messageId });
      return { messageId, deliveryId };
    });
  }
}
