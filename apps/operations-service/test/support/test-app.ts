import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { permissionsForRole, type RoleKey } from '@solmira/contracts';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import { startTestIssuer, type TestIssuer } from '@solmira/service-kit/testing';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SERVICE_NAME, envSchema, type OperationsConfig } from '../../src/config.js';
import type { MemberLookup, OrganizationMember } from '../../src/members/member-lookup.js';

export const TEST_BUCKET = 'solmira-test-media';
const S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9000',
  accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? 'solmira',
  secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'solmira_dev_minio_password',
};

/**
 * Stand-in for identity-service's member endpoint at the service boundary. It answers exactly as
 * identity would for a caller of the given organization: a member of another organization is
 * simply not found. The real HTTP adapter has its own test.
 */
export class FakeMemberLookup implements MemberLookup {
  private readonly members = new Map<string, OrganizationMember>();

  add(
    organizationId: string,
    member: Omit<OrganizationMember, 'memberId' | 'userId'> & { memberId?: string },
  ): OrganizationMember {
    const full = {
      memberId: member.memberId ?? randomUUID(),
      userId: randomUUID(),
      ...member,
    } as OrganizationMember;
    this.members.set(`${organizationId}:${full.memberId}`, full);
    return full;
  }

  async find(organizationId: string, memberId: string): Promise<OrganizationMember | null> {
    return this.members.get(`${organizationId}:${memberId}`) ?? null;
  }
}

export interface Actor {
  readonly organizationId: string;
  readonly userId: string;
  readonly token: string;
  readonly auth: { Authorization: string };
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: OperationsConfig;
  readonly issuer: TestIssuer;
  readonly members: FakeMemberLookup;
  readonly db: pg.Pool;
  readonly http: () => ReturnType<typeof request>;
  /** A signed-in member of an organization with the given role's real permission set. */
  actor(organizationId: string, role: RoleKey): Promise<Actor>;
  close(): Promise<void>;
}

export async function ensureTestBucket(): Promise<void> {
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: S3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error;
  }
}

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
    S3_BUCKET: TEST_BUCKET,
    S3_ENDPOINT: S3.endpoint,
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACCESS_KEY_ID: S3.accessKeyId,
    S3_SECRET_ACCESS_KEY: S3.secretAccessKey,
  });
  const members = new FakeMemberLookup();
  const app = await createServiceApp(AppModule.register(config, { memberLookup: members }), {
    serviceName: SERVICE_NAME,
    nodeEnv: 'test',
  });
  await app.init();
  const db = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });

  return {
    app,
    config,
    issuer,
    members,
    db,
    http: () => request(app.getHttpServer()),
    async actor(organizationId, role) {
      const userId = randomUUID();
      const token = await issuer.sign({
        userId,
        sessionId: randomUUID(),
        organizationId,
        role,
        permissions: permissionsForRole(role),
      });
      return { organizationId, userId, token, auth: { Authorization: `Bearer ${token}` } };
    },
    async close() {
      await app.close();
      await db.end();
      await issuer.close();
    },
  };
}

export const newOrganizationId = () => randomUUID();
