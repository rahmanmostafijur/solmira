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
  'INVALID_CREDENTIALS',
  'INVALID_CURRENT_PASSWORD',
  'TOKEN_EXPIRED',
  'ACCOUNT_DISABLED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNKNOWN_EVENT_TYPE',
  'PAYLOAD_INVALID',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * Stable machine codes for the rule a field broke. Clients can switch on them; the message is for
 * people and may be reworded. More codes may be added, so clients must tolerate unknown ones.
 */
export const FIELD_ISSUE_RULES = [
  'required',
  'invalid_type',
  'too_short',
  'too_long',
  'too_small',
  'too_big',
  'invalid_format',
  'invalid_enum',
  'unrecognized_key',
  'invalid',
] as const;
export type FieldIssueRule = (typeof FIELD_ISSUE_RULES)[number];

/**
 * One problem with one request field. `path` names the field (a dotted body path, a query
 * parameter, a path parameter or a header name); `message` says what to send instead. The other
 * fields are present when known: the broken `rule`, an `example` of a valid value, and the
 * `minimum` / `maximum` bound (a length for text and lists, a value for numbers).
 */
export const fieldIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  // A plain string on the wire, so an older client does not reject a newer rule code.
  rule: z.string().optional(),
  example: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
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
