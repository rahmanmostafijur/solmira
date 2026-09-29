import { z } from 'zod';

/** Set by the gateway for every inbound request; unique per HTTP hop. */
export const REQUEST_ID_HEADER = 'x-request-id';
/** Propagated across HTTP calls and events; ties one business operation together. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

export const API_PREFIX = '/api/v1';

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const fieldIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof fieldIssueSchema>;

/** The single error envelope returned by every service and by the gateway. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(fieldIssueSchema).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
