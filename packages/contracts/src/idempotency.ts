import { z } from 'zod';

/**
 * Retry-safe writes: the client sends a unique key per logical operation, and a retry with the
 * same key returns the original result instead of repeating the operation.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const idempotencyKeySchema = z
  .string({ error: 'Send an Idempotency-Key header, e.g. a UUID generated for this request' })
  .trim()
  .regex(/^[A-Za-z0-9_\-:.]{8,100}$/, 'Idempotency-Key must be 8-100 letters, digits or - _ : .');
