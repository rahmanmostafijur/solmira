import { z } from 'zod';

/**
 * Retry-safe writes: the client sends a unique key per logical operation, and a retry with the
 * same key returns the original result instead of repeating the operation.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 100;
export const IDEMPOTENCY_KEY_EXAMPLE = 'order-1234-created';

const lengthMessage = (issue: { input?: unknown }) =>
  `Idempotency-Key must be ${IDEMPOTENCY_KEY_MIN_LENGTH} to ${IDEMPOTENCY_KEY_MAX_LENGTH} ` +
  `characters long (letters, digits, - _ : .); got ${String(issue.input ?? '').length}. ` +
  `Example: ${IDEMPOTENCY_KEY_EXAMPLE}`;

export const idempotencyKeySchema = z
  .string({
    error:
      'Send an Idempotency-Key header with a value unique to this message, ' +
      `${IDEMPOTENCY_KEY_MIN_LENGTH} to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters long. ` +
      `Example: ${IDEMPOTENCY_KEY_EXAMPLE}`,
  })
  .trim()
  .min(IDEMPOTENCY_KEY_MIN_LENGTH, { error: lengthMessage })
  .max(IDEMPOTENCY_KEY_MAX_LENGTH, { error: lengthMessage })
  .regex(
    /^[A-Za-z0-9_\-:.]+$/,
    'Idempotency-Key can only contain letters, digits and - _ : . (no spaces or other symbols). ' +
      `Example: ${IDEMPOTENCY_KEY_EXAMPLE}`,
  )
  .meta({ examples: [IDEMPOTENCY_KEY_EXAMPLE] });
