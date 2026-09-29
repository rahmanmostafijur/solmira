import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceApp } from '../src/bootstrap.js';
import { ProbeModule } from './probe.module.js';

// Defaults match docker-compose.yml; CI overrides them to point at its service containers.
const env = {
  postgres:
    process.env.TEST_DATABASE_URL ??
    'postgres://solmira:solmira_dev_password@localhost:5433/postgres',
  redis: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
  rabbitmq: process.env.TEST_RABBITMQ_URL ?? 'amqp://solmira:solmira_dev_password@localhost:5672',
};

describe('service platform against real infrastructure', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createServiceApp(
      ProbeModule.register({
        serviceName: 'probe-service',
        logging: { level: process.env.TEST_LOG_LEVEL ?? 'silent', pretty: false },
        postgres: { url: env.postgres, poolMax: 2 },
        redis: { url: env.redis },
        rabbitmq: { url: env.rabbitmq },
      }),
      { serviceName: 'probe-service', nodeEnv: 'test' },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('becomes ready once Postgres, Redis and RabbitMQ are reachable', async () => {
    // Redis and RabbitMQ connect in the background after init, so poll briefly.
    const deadline = Date.now() + 10_000;
    let body: { status: string; checks: { name: string; status: string }[] } | undefined;
    while (Date.now() < deadline) {
      const response = await request(app.getHttpServer()).get('/health/ready');
      body = response.body;
      if (response.status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(body?.checks.map((check) => `${check.name}:${check.status}`).sort()).toEqual([
      'postgres:ok',
      'rabbitmq:ok',
      'redis:ok',
    ]);
    expect(body?.status).toBe('ok');
  });
});
