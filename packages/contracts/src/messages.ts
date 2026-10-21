import { z } from 'zod';
import { eventTypeNameSchema } from './applications.js';
import { paginationQuerySchema } from './pagination.js';
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

// ---- inspection (Phase 8) -----------------------------------------------------------------------

export const DELIVERY_STATUSES = ['pending', 'in_progress', 'succeeded', 'failed'] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/** Event types starting with this prefix belong to the platform (for example the test event). */
export const RESERVED_EVENT_TYPE_PREFIX = 'solmira.';
export const TEST_EVENT_TYPE = 'solmira.test';

export const messageListQuerySchema = paginationQuerySchema.extend({
  eventType: eventTypeNameSchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export const messageSummarySchema = messageSchema.extend({
  payloadBytes: z.number().int(),
  deliveries: z.object({
    pending: z.number().int(),
    in_progress: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
  }),
});
export type MessageSummary = z.infer<typeof messageSummarySchema>;

export const deliverySummarySchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  endpointId: z.uuid(),
  endpointUrl: z.string(),
  eventType: z.string(),
  status: deliveryStatusSchema,
  attemptCount: z.number().int(),
  nextAttemptAt: timestampSchema,
  lastAttemptAt: timestampSchema.nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastErrorClass: z.string().nullable(),
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type DeliverySummary = z.infer<typeof deliverySummarySchema>;

export const attemptSchema = z.object({
  deliveryId: z.uuid(),
  endpointId: z.uuid(),
  attempt: z.number().int(),
  startedAt: timestampSchema,
  durationMs: z.number().int(),
  statusCode: z.number().int().nullable(),
  errorClass: z.string().nullable(),
  responseBody: z.string().nullable(),
  responseBodyTruncated: z.boolean(),
  nextAttemptAt: timestampSchema.nullable(),
});
export type AttemptView = z.infer<typeof attemptSchema>;

export const messageDetailSchema = messageSummarySchema.omit({ deliveries: true }).extend({
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string(),
  deliveries: z.array(deliverySummarySchema),
  /** The timeline of every attempt, oldest first. Empty with `attemptsAvailable: false` if the history is down. */
  attempts: z.array(attemptSchema),
  attemptsAvailable: z.boolean(),
});
export type MessageDetail = z.infer<typeof messageDetailSchema>;

export const deliveryListQuerySchema = paginationQuerySchema.extend({
  status: deliveryStatusSchema.optional(),
});
export type DeliveryListQuery = z.infer<typeof deliveryListQuerySchema>;

export const testSendResultSchema = z.object({ messageId: z.uuid(), deliveryId: z.uuid() });
export type TestSendResult = z.infer<typeof testSendResultSchema>;
