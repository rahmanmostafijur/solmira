import { afterEach, describe, expect, it } from 'vitest';
import { shutdownTracing, startTracing, tracingEnvSchema } from './tracing.js';

describe('startTracing', () => {
  afterEach(() => shutdownTracing());

  it('does nothing without an exporter endpoint, so every span call stays a no-op', () => {
    expect(startTracing('ingest-service', 'test', {})).toBeUndefined();
  });

  it('starts with an endpoint and can be shut down', async () => {
    const handle = startTracing('ingest-service', 'production', {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    });
    expect(handle).toBeDefined();
    await expect(handle!.shutdown()).resolves.toBeUndefined();
  });

  it('reads the sampling share and refuses nonsense', () => {
    expect(tracingEnvSchema.parse({}).OTEL_TRACES_SAMPLER_ARG).toBe(0.1);
    expect(tracingEnvSchema.parse({ OTEL_TRACES_SAMPLER_ARG: '0.5' }).OTEL_TRACES_SAMPLER_ARG).toBe(
      0.5,
    );
    expect(tracingEnvSchema.safeParse({ OTEL_TRACES_SAMPLER_ARG: '2' }).success).toBe(false);
    expect(tracingEnvSchema.safeParse({ OTEL_EXPORTER_OTLP_ENDPOINT: 'not a url' }).success).toBe(
      false,
    );
  });
});
