import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { SpanKind, SpanStatusCode } from '@solmira/telemetry';
import { lastValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { installTestTracing } from '@solmira/telemetry/testing';
import { TracingInterceptor } from './tracing.interceptor.js';

const tracing = installTestTracing();

function executionContext(
  headers: Record<string, string>,
  statusCode = 200,
  type = 'http',
): ExecutionContext {
  const request = {
    method: 'GET',
    headers,
    route: { path: '/applications/:applicationId' },
    originalUrl: '/api/v1/applications/0190a000-0000-7000-8000-000000000001?token=secret',
  };
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode }) }),
  } as unknown as ExecutionContext;
}

const handler = (result: ReturnType<CallHandler['handle']>): CallHandler => ({
  handle: () => result,
});
const run = (context: ExecutionContext, next: CallHandler) =>
  lastValueFrom(
    new TracingInterceptor().intercept(context, next) as ReturnType<CallHandler['handle']>,
  );

describe('TracingInterceptor', () => {
  beforeEach(() => tracing.reset());

  it('names the span by the route pattern and records the status, never the path or query', async () => {
    await run(executionContext({}, 201), handler(of('ok')));

    const [span] = tracing.spans();
    expect(span!.name).toBe('GET /applications/:applicationId');
    expect(span!.kind).toBe(SpanKind.SERVER);
    expect(span!.attributes['http.response.status_code']).toBe(201);
    expect(JSON.stringify(span!.attributes)).not.toContain('secret');
    expect(JSON.stringify(span!.attributes)).not.toContain('0190a000');
  });

  it('continues the trace of a caller that sends traceparent', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parent = '00f067aa0ba902b7';
    await run(executionContext({ traceparent: `00-${traceId}-${parent}-01` }), handler(of('ok')));

    const [span] = tracing.spans();
    expect(span!.spanContext().traceId).toBe(traceId);
    expect(span!.parentSpanContext?.spanId).toBe(parent);
  });

  it('continues the trace the load balancer started with X-Amzn-Trace-Id', async () => {
    await run(
      executionContext({
        'x-amzn-trace-id':
          'Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1',
      }),
      handler(of('ok')),
    );

    const [span] = tracing.spans();
    expect(span!.spanContext().traceId).toBe('5759e988bd862e3fe1be46a994272793');
    expect(span!.parentSpanContext?.spanId).toBe('53995c3f42cd8ad8');
  });

  it('marks a failed request and a server error, and still ends the span', async () => {
    await expect(
      run(executionContext({}), handler(throwError(() => new Error('boom')))),
    ).rejects.toThrow('boom');
    await run(executionContext({}, 503), handler(of('degraded')));

    const [failed, unavailable] = tracing.spans();
    expect(failed!.status.code).toBe(SpanStatusCode.ERROR);
    expect(unavailable!.status.code).toBe(SpanStatusCode.ERROR);
    expect(unavailable!.attributes['http.response.status_code']).toBe(503);
  });

  it('leaves other kinds of calls alone', async () => {
    await run(executionContext({}, 200, 'rpc'), handler(of('ok')));
    expect(tracing.spans()).toEqual([]);
  });
});
