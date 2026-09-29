import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { SERVICE_NAME, envSchema } from '../src/config.js';

// Unreachable dependencies: this test proves the module graph wires up, not that infra is healthy.
const config = loadConfig(envSchema, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  RABBITMQ_URL: 'amqp://test:test@127.0.0.1:1',
});

describe(SERVICE_NAME, () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createServiceApp(AppModule.register(config), {
      serviceName: SERVICE_NAME,
      nodeEnv: 'test',
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and serves liveness', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('reports every infrastructure dependency it declares, and only those', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(response.body.service).toBe(SERVICE_NAME);
    expect(response.body.checks.map((check: { name: string }) => check.name).sort()).toEqual([
      'postgres',
      'rabbitmq',
    ]);
  });
});
