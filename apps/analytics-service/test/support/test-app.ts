import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { permissionsForRole, type Permission, type RoleKey } from '@solmira/contracts';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import { startTestIssuer, type TestIssuer } from '@solmira/service-kit/testing';
import amqp from 'amqplib';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { MaintenanceService } from '../../src/analytics/maintenance.service.js';
import { AppModule } from '../../src/app.module.js';
import { SERVICE_NAME, envSchema } from '../../src/config.js';

const RABBITMQ =
  process.env.TEST_RABBITMQ_URL ?? 'amqp://solmira:solmira_dev_password@localhost:5672';

export interface Actor {
  readonly organizationId: string;
  readonly auth: { Authorization: string };
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly db: pg.Pool;
  readonly maintenance: MaintenanceService;
  readonly http: () => ReturnType<typeof request>;
  actor(organizationId: string, role: RoleKey, permissions?: readonly Permission[]): Promise<Actor>;
  /** Publishes an integration event the way the outbox relay would. */
  publish(
    type: string,
    organizationId: string | null,
    payload: object,
    eventId?: string,
  ): Promise<string>;
  close(): Promise<void>;
}

export const newOrganizationId = () => randomUUID();

export async function createTestApp(): Promise<TestApp> {
  const issuer: TestIssuer = await startTestIssuer();
  const config = loadConfig(envSchema, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('appDatabaseUrl'),
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    RABBITMQ_URL: RABBITMQ,
    IDENTITY_JWKS_URL: issuer.jwksUrl,
  });
  const app = await createServiceApp(AppModule.register(config), {
    serviceName: SERVICE_NAME,
    nodeEnv: 'test',
  });
  await app.init();
  const db = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });
  const connection = await amqp.connect(RABBITMQ);
  const channel = await connection.createConfirmChannel();
  // Wait for the consumer to declare its queue, so a published event is not dropped.
  for (let i = 0; i < 100; i += 1) {
    const probe = await connection.createChannel();
    probe.on('error', () => undefined);
    const exists = await probe.checkQueue('analytics.delivery-attempts').then(
      () => true,
      () => false,
    );
    await probe.close().catch(() => undefined);
    if (exists) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    app,
    db,
    maintenance: app.get(MaintenanceService),
    http: () => request(app.getHttpServer()),
    async actor(organizationId, role, permissions) {
      const token = await issuer.sign({
        userId: randomUUID(),
        sessionId: randomUUID(),
        organizationId,
        role,
        permissions: permissions ?? permissionsForRole(role),
      });
      return { organizationId, auth: { Authorization: 'Bearer ' + token } };
    },
    async publish(type, organizationId, payload, eventId = randomUUID()) {
      const envelope = {
        eventId,
        type,
        version: 1,
        occurredAt: new Date().toISOString(),
        organizationId,
        actorId: null,
        correlationId: 'test',
        causationId: null,
        payload,
      };
      channel.publish('solmira.events', type, Buffer.from(JSON.stringify(envelope)), {
        persistent: true,
      });
      await channel.waitForConfirms();
      return eventId;
    },
    async close() {
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await app.close();
      await db.end();
      await issuer.close();
    },
  };
}
