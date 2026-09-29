import { describe, expect, it } from 'vitest';
import {
  getRequestContext,
  resolveRequestContext,
  runWithRequestContext,
} from './request-context.js';

const generate = () => 'generated-id-0001';

describe('resolveRequestContext', () => {
  it('generates a request ID and reuses it as correlation ID when none is supplied', () => {
    expect(resolveRequestContext({}, generate)).toEqual({
      requestId: 'generated-id-0001',
      correlationId: 'generated-id-0001',
    });
  });

  it('keeps well-formed incoming IDs', () => {
    const context = resolveRequestContext(
      { 'x-request-id': 'req-12345678', 'x-correlation-id': 'corr-12345678' },
      generate,
    );

    expect(context).toEqual({ requestId: 'req-12345678', correlationId: 'corr-12345678' });
  });

  it.each([
    ['log injection', 'abc\n{"level":"fatal"}'],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['unsafe characters', '<script>alert(1)</script>'],
  ])('rejects %s in incoming IDs', (_label, value) => {
    const context = resolveRequestContext(
      { 'x-request-id': value, 'x-correlation-id': value },
      generate,
    );

    expect(context).toEqual({ requestId: 'generated-id-0001', correlationId: 'generated-id-0001' });
  });

  it('uses the first value when a header is repeated', () => {
    const context = resolveRequestContext(
      { 'x-correlation-id': ['first-value-1', 'second-value-2'] },
      generate,
    );

    expect(context.correlationId).toBe('first-value-1');
  });
});

describe('runWithRequestContext', () => {
  it('exposes the context across async boundaries', async () => {
    const context = { requestId: 'req-12345678', correlationId: 'corr-12345678' };

    const seen = await runWithRequestContext(context, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getRequestContext();
    });

    expect(seen).toEqual(context);
    expect(getRequestContext()).toBeUndefined();
  });
});
