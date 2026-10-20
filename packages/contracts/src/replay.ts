import { z } from 'zod';
import { timestampSchema } from './resource-fields.js';

/** Replaying deliveries (ADR-0033). */

export const MAX_BULK_REPLAY = 5_000;

export const replayMessageRequestSchema = z.object({
  /** Replay only the delivery to this endpoint; omit to replay every delivery of the message. */
  endpointId: z.uuid().optional(),
});
export type ReplayMessageRequest = z.infer<typeof replayMessageRequestSchema>;

export const replayEndpointRequestSchema = z
  .object({
    /** Messages created in this range are considered (inclusive start, exclusive end). */
    from: timestampSchema,
    to: timestampSchema,
    /** At most this many deliveries are replayed per call; repeat the call for the rest. */
    limit: z.number().int().min(1).max(MAX_BULK_REPLAY).default(MAX_BULK_REPLAY),
  })
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), {
    path: ['to'],
    message: 'The end of the range must be after its start',
  });
export type ReplayEndpointRequest = z.infer<typeof replayEndpointRequestSchema>;

export const replayResultSchema = z.object({
  /** Deliveries put back in the queue by this call. */
  replayed: z.number().int().min(0),
  /** True when more matching deliveries remain; call again. */
  more: z.boolean(),
});
export type ReplayResult = z.infer<typeof replayResultSchema>;
