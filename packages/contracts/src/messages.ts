import { z } from 'zod';
import { eventTypeNameSchema } from './applications.js';
import { timestampSchema } from './resource-fields.js';

/** Message ingestion (ADR-0030). */

export const DEFAULT_MAX_MESSAGE_PAYLOAD_BYTES = 256 * 1024;
export const DEFAULT_IDEMPOTENCY_RETENTION_SECONDS = 24 * 60 * 60;

export const createMessageRequestSchema = z.object({
  eventType: eventTypeNameSchema,
  /** Any JSON object; it is delivered to endpoints unchanged. */
  payload: z.record(z.string(), z.unknown()),
});
export type CreateMessageRequest = z.infer<typeof createMessageRequestSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  eventType: z.string(),
  createdAt: timestampSchema,
});
export type Message = z.infer<typeof messageSchema>;
