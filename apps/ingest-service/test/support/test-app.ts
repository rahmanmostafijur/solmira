import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import { startTestIssuer, type TestIssuer } from '@solmira/service-kit/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SERVICE_NAME, envSchema } from '../../src/config.js';

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly issuer: TestIssuer;
  readonly http: () => ReturnType<typeof request>;
  close(): Promise<void>;
}

/** The service wired to real PostgreSQL (as the RLS-restricted runtime role), Redis and RabbitMQ. */
export async function createTestApp(): Promise<TestApp> {
  const issuer = await startTestIssuer();
  const config = loadConfig(envSchema, {
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: inject('appDatabaseUrl'),
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    RABBITMQ_URL:
      process.env.TEST_RABBITMQ_URL ?? 'amqp://solmira:solmira_dev_password@localhost:5672',
    IDENTITY_JWKS_URL: issuer.jwksUrl,
  });
  const app = await createServiceApp(AppModule.register(config), {
    serviceName: SERVICE_NAME,
    nodeEnv: 'test',
  });
  await app.init();

  return {
    app,
    issuer,
    http: () => request(app.getHttpServer()),
    async close() {
      await app.close();
      await issuer.close();
    },
  };
}
