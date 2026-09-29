import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceApp } from '../src/bootstrap.js';
import { INTERNAL_ERROR_MESSAGE } from '../src/errors/error-response.js';
import { ProbeModule } from './probe.module.js';

// Port 1 is never listening, so the Postgres readiness check fails fast and deterministically.
const UNREACHABLE_POSTGRES = 'postgres://probe:probe@127.0.0.1:1/probe';

describe('service platform (no infrastructure)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createServiceApp(
      ProbeModule.register({
        serviceName: 'probe-service',
        logging: { level: 'silent', pretty: false },
        postgres: { url: UNREACHABLE_POSTGRES, poolMax: 1 },
      }),
      { serviceName: 'probe-service', nodeEnv: 'test' },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('serves liveness outside the versioned API prefix', async () => {
    const response = await http().get('/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports not-ready with 503 when a dependency is down, without leaking the cause', async () => {
    const response = await http().get('/health/ready').expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      service: 'probe-service',
      checks: [{ name: 'postgres', status: 'error' }],
    });
    expect(JSON.stringify(response.body)).not.toContain('127.0.0.1');
  });

  it('routes application endpoints under /api/v1', async () => {
    await http().get('/probe/missing').expect(404);
    await http().get('/api/v1/probe/missing').expect(404);
  });

  it('returns the error envelope with the request ID for domain errors', async () => {
    const response = await http().get('/api/v1/probe/missing').expect(404);

    expect(response.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Order not found',
        requestId: response.headers['x-request-id'],
      },
    });
  });

  it('masks unexpected errors', async () => {
    const response = await http().get('/api/v1/probe/crash').expect(500);

    expect(response.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: INTERNAL_ERROR_MESSAGE,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.1\.2\.3|password|admin/);
  });

  it('propagates a valid incoming correlation ID', async () => {
    const response = await http()
      .get('/health/live')
      .set('X-Correlation-Id', 'order-flow-20260929')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('order-flow-20260929');
  });

  it('rejects invalid bodies with field-level details', async () => {
    const response = await http()
      .post('/api/v1/probe/things')
      .send({ name: '', quantity: 0 })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      'name',
      'quantity',
    ]);
  });

  it('strips fields the schema does not declare (mass assignment defence)', async () => {
    const response = await http()
      .post('/api/v1/probe/things')
      .send({ name: 'Pallet', quantity: 2, organizationId: 'someone-elses-org' })
      .expect(201);

    expect(response.body).toEqual({ name: 'Pallet', quantity: 2 });
  });

  it('answers malformed JSON with the error envelope', async () => {
    const response = await http()
      .post('/api/v1/probe/things')
      .set('Content-Type', 'application/json')
      .send('{"name": "Pallet",')
      .expect(400);

    // Nest wraps the parser's SyntaxError in a BadRequestException; its message describes the
    // client's own payload, not server internals.
    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('rejects oversized bodies with 413', async () => {
    const response = await http()
      .post('/api/v1/probe/things')
      .send({ name: 'x'.repeat(1_100_000), quantity: 1 })
      .expect(413);

    expect(response.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
    });
  });

  it('answers unknown routes with the error envelope', async () => {
    const response = await http().get('/api/v1/does-not-exist').expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('sets a restrictive content security policy and hides the framework', async () => {
    const response = await http().get('/health/live');

    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
