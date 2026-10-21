import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context, propagation, trace } from '@opentelemetry/api';
import { CompositePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { z } from 'zod';

/** Standard OpenTelemetry variables, read by every service (ADR-0039). Tracing is off without an endpoint. */
export const tracingEnvSchema = z.object({
  /** Where traces go: the OpenTelemetry collector next to the service (ADOT in ECS). */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  /** Share of new traces that are recorded, 0 to 1. A trace that arrives sampled stays sampled. */
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).default(0.1),
  /** AWS X-Ray accepts only trace ids that start with the time; this makes ours so. */
  TRACING_XRAY_IDS: z.stringbool().default(false),
});

export interface TracingHandle {
  shutdown(): Promise<void>;
}

let running: TracingHandle | undefined;

/** Flushes the spans still waiting to be sent. Safe to call when tracing is off. */
export async function shutdownTracing(): Promise<void> {
  const handle = running;
  running = undefined;
  await handle?.shutdown();
}

/**
 * Starts exporting traces and returns a handle to flush them at shutdown, or undefined when no
 * endpoint is configured (every span call is then a no-op). Call before the application is created.
 * Spans carry ids and names, never URLs of endpoints, payloads, headers or secrets.
 */
export function startTracing(
  serviceName: string,
  environment: string,
  env: Record<string, string | undefined> = process.env,
): TracingHandle | undefined {
  const settings = tracingEnvSchema.parse(env);
  if (!settings.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;

  const exporter = new OTLPTraceExporter({
    url: settings.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '') + '/v1/traces',
  });
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'deployment.environment.name': environment,
    }),
    spanProcessors: [new BatchSpanProcessor({ exporter })],
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(settings.OTEL_TRACES_SAMPLER_ARG),
    }),
    ...(settings.TRACING_XRAY_IDS ? { idGenerator: new AWSXRayIdGenerator() } : {}),
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(provider);
  // W3C traceparent between our own services, and the ALB's X-Amzn-Trace-Id at the edge.
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new AWSXRayPropagator()],
    }),
  );
  running = { shutdown: () => provider.shutdown() };
  return running;
}
