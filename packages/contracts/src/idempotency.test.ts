import { describe, expect, it } from 'vitest';
import { idempotencyKeySchema } from './idempotency.js';

describe('idempotencyKeySchema', () => {
  it('accepts UUIDs and similar tokens, nothing unsafe', () => {
    expect(idempotencyKeySchema.safeParse('0190b0a0-7c5e-7000-8000-000000000009').success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse('receipt:2026-10-01.1').success).toBe(true);
    for (const bad of [
      undefined,
      '',
      'short',
      'has spaces here',
      'x'.repeat(101),
      'semi;colon;key',
    ])
      expect(idempotencyKeySchema.safeParse(bad).success, String(bad)).toBe(false);
  });
});
