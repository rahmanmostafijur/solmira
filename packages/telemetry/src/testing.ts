import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { CompositePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace';

let exporter: InMemorySpanExporter | undefined;

/**
 * Records spans in memory for tests, with the same propagators as production. OpenTelemetry allows
 * one global provider per process, so this installs it once and later calls share it.
 */
export function installTestTracing(): { spans(): ReadableSpan[]; reset(): void } {
  if (!exporter) {
    exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new AWSXRayPropagator()],
      }),
    );
  }
  const memory = exporter;
  return { spans: () => memory.getFinishedSpans(), reset: () => memory.reset() };
}
