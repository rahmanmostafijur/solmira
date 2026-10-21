import { SpanKind, SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

const TRACER_NAME = 'solmira';

/**
 * Runs `work` inside a span that becomes the parent of any span it starts, records a thrown error on
 * the span, and always ends it. Without an exporter the span is not recorded and this costs a few
 * function calls. Attributes are for ids, names and counts: never payloads, URLs, headers or secrets.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  return trace.getTracer(TRACER_NAME).startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      return await work(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** The ids of the span that is active now, for log lines; undefined outside a recorded span. */
export function activeTraceIds(): { traceId: string; spanId: string } | undefined {
  const span = trace.getActiveSpan();
  const context = span?.spanContext();
  if (!context || !trace.isSpanContextValid(context)) return undefined;
  return { traceId: context.traceId, spanId: context.spanId };
}
