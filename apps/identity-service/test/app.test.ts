import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { SERVICE_NAME, envSchema } from '../src/config.js';

describe(SERVICE_NAME, () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const keys = await generateKeyPair('EdDSA', { extractable: true });
    // Unreachable dependencies: this test proves the module graph wires up, not that infra is healthy.
    const config = loadConfig(envSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
      REDIS_URL: 'redis://127.0.0.1:1',
      RABBITMQ_URL: 'amqp://test:test@127.0.0.1:1',
      JWT_PRIVATE_KEY: await exportPKCS8(keys.privateKey),
      JWT_PUBLIC_KEY: await exportSPKI(keys.publicKey),
    });
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

  it('reports every dependency it declares, including the RLS enforcement check', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);

    expect(response.body.service).toBe(SERVICE_NAME);
    expect(response.body.checks.map((check: { name: string }) => check.name).sort()).toEqual([
      'postgres',
      'rabbitmq',
      'redis',
      'row-level-security',
    ]);
  });

  it('protects API routes by default', async () => {
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
  });

  it('refuses to start without signing keys', () => {
    expect(() =>
      loadConfig(envSchema, {
        DATABASE_URL: 'postgres://h/db',
        REDIS_URL: 'redis://h',
        RABBITMQ_URL: 'amqp://h',
      }),
    ).toThrow(/JWT_PRIVATE_KEY[\s\S]*JWT_PUBLIC_KEY|JWT_PUBLIC_KEY[\s\S]*JWT_PRIVATE_KEY/);
  });
});
