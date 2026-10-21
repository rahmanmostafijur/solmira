import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSpan } from './spans.js';
import { shutdownTracing, startTracing } from './tracing.js';

/** A stand-in for the OpenTelemetry collector: records what is posted to /v1/traces. */
describe('exporting spans', () => {
  let collector: Server;
  const bodies: string[] = [];
  let endpoint = '';

  beforeAll(async () => {
    collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/v1/traces') bodies.push(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(collector.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await shutdownTracing();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
  });

  it('sends a finished span to the collector with the service name, and X-Ray compatible ids', async () => {
    startTracing('dispatcher', 'production', {
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_TRACES_SAMPLER_ARG: '1',
      TRACING_XRAY_IDS: 'true',
    });

    await withSpan(
      'delivery.attempt',
      { 'endpoint.id': 'ep-1', 'delivery.attempt': 2 },
      async () => 1,
    );
    await shutdownTracing();

    expect(bodies).toHaveLength(1);
    const payload = JSON.parse(bodies[0]!);
    const resource = payload.resourceSpans[0].resource.attributes as {
      key: string;
      value: unknown;
    }[];
    expect(resource.find((attribute) => attribute.key === 'service.name')?.value).toEqual({
      stringValue: 'dispatcher',
    });
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe('delivery.attempt');
    expect(JSON.stringify(span.attributes)).toContain('ep-1');
    // X-Ray rejects trace ids that do not start with the time the trace began (epoch seconds, in hex).
    const startedSeconds = parseInt(span.traceId.slice(0, 8), 16);
    expect(Math.abs(startedSeconds - Date.now() / 1000)).toBeLessThan(60);
  });
});
