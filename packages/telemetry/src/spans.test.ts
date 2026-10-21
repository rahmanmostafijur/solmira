import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { beforeEach, describe, expect, it } from 'vitest';
import { installTestTracing } from './testing.js';
import { activeTraceIds, withSpan } from './spans.js';

const tracing = installTestTracing();

describe('withSpan', () => {
  beforeEach(() => tracing.reset());

  it('records a span with its attributes and returns the result', async () => {
    const result = await withSpan('ingest.message', { 'application.id': 'app-1' }, async () => 42);

    expect(result).toBe(42);
    const [span] = tracing.spans();
    expect(span).toMatchObject({ name: 'ingest.message', kind: SpanKind.INTERNAL });
    expect(span!.attributes['application.id']).toBe('app-1');
    expect(span!.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('makes a span started inside it a child, in the same trace', async () => {
    await withSpan('outer', {}, async () => {
      await withSpan('inner', {}, async () => undefined);
    });
    const inner = tracing.spans().find((span) => span.name === 'inner')!;
    const outer = tracing.spans().find((span) => span.name === 'outer')!;
    expect(inner.spanContext().traceId).toBe(outer.spanContext().traceId);
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
  });

  it('records the error, marks the span failed, ends it and rethrows', async () => {
    await expect(
      withSpan('deliver', {}, async () => {
        throw new Error('receiver refused');
      }),
    ).rejects.toThrow('receiver refused');

    const [span] = tracing.spans();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.events.map((event) => event.name)).toContain('exception');
  });

  it('exposes the ids of the active span, and nothing outside one', async () => {
    expect(activeTraceIds()).toBeUndefined();
    await withSpan('x', {}, async () => {
      expect(activeTraceIds()).toMatchObject({
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
      });
    });
  });
});
