import {
  deliveryAttemptedPayloadSchema,
  type EventEnvelope,
  type RealtimeEvent,
} from '@solmira/contracts';
import { z } from 'zod';

/** The event types the feed listens for. Everything else on the exchange is not its business. */
export const FEED_EVENT_TYPES = [
  'message.created',
  'delivery.attempted',
  'endpoint.auto_disabled',
] as const;

const messageCreatedSchema = z.object({ messageId: z.uuid(), applicationId: z.uuid() });
const autoDisabledSchema = z.object({
  endpointId: z.uuid(),
  applicationId: z.uuid(),
  host: z.string(),
});

/**
 * Maps an integration event to what a client may see. Only named fields are copied, so a field
 * added to an internal event later does not reach clients by accident. Returns null for anything
 * that is not a valid, tenant-owned event of a feed type.
 */
export function toRealtimeEvent(event: EventEnvelope): RealtimeEvent | null {
  if (!event.organizationId) return null;
  const occurredAt = event.occurredAt;
  switch (event.type) {
    case 'message.created': {
      const parsed = messageCreatedSchema.safeParse(event.payload);
      return parsed.success ? { type: event.type, occurredAt, data: parsed.data } : null;
    }
    case 'delivery.attempted': {
      const parsed = deliveryAttemptedPayloadSchema.safeParse(event.payload);
      return parsed.success ? { type: event.type, occurredAt, data: parsed.data } : null;
    }
    case 'endpoint.auto_disabled': {
      const parsed = autoDisabledSchema.safeParse(event.payload);
      return parsed.success ? { type: event.type, occurredAt, data: parsed.data } : null;
    }
    default:
      return null;
  }
}
