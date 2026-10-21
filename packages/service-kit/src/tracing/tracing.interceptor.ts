import {
  Injectable,
  Module,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
  shutdownTracing,
  trace,
  type Span,
} from '@solmira/telemetry';
import { Observable } from 'rxjs';
import { getRequestContext } from '../context/request-context.js';

interface HttpRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  route?: { path?: string };
  originalUrl?: string;
}

interface HttpResponse {
  statusCode: number;
}

/**
 * A server span for every HTTP request. The trace continues from the caller: a W3C `traceparent` from
 * another of our services, or the `X-Amzn-Trace-Id` the load balancer adds. The span is named by the
 * route pattern (`GET /applications/:applicationId`), never by the concrete path, so ids do not
 * become metric dimensions or span names. Query strings are not recorded.
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (executionContext.getType() !== 'http') return next.handle();
    const http = executionContext.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();

    const parent = propagation.extract(context.active(), request.headers);
    const route = request.route?.path ?? 'unmatched';
    const span = trace.getTracer('solmira').startSpan(
      `${request.method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.request.method': request.method,
          'http.route': route,
          'correlation.id': getRequestContext()?.correlationId ?? '',
        },
      },
      parent,
    );
    const active = trace.setSpan(parent, span);

    return new Observable((subscriber) => {
      const finish = (error?: unknown) => {
        endHttpSpan(span, response.statusCode, error);
      };
      const subscription = context
        .with(active, () => next.handle())
        .subscribe({
          next: (value) => subscriber.next(value),
          error: (error: unknown) => {
            finish(error);
            subscriber.error(error);
          },
          complete: () => {
            finish();
            subscriber.complete();
          },
        });
      return () => subscription.unsubscribe();
    });
  }
}

function endHttpSpan(span: Span, statusCode: number, error?: unknown): void {
  span.setAttribute('http.response.status_code', statusCode);
  if (error instanceof Error) span.recordException(error);
  if (error !== undefined || statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
}

@Injectable()
class TracingShutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}

/** Registers the interceptor for every route of a service, and flushes spans when it stops. */
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: TracingInterceptor }, TracingShutdown],
})
export class TracingModule {}
