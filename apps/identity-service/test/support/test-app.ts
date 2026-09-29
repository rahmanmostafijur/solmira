import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createServiceApp, loadConfig } from '@solmira/service-kit';
import { SignJWT, exportPKCS8, exportSPKI, generateKeyPair, type CryptoKey } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { SERVICE_NAME, envSchema, type IdentityConfig } from '../../src/config.js';
import type { EmailMessage, EmailSender } from '../../src/mail/email-sender.js';

/** In-memory mailbox at the outbound boundary; everything else in the app is real. */
export class CapturedEmails implements EmailSender {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }

  /** The token from the most recent email to `to` that links to `path`. */
  tokenFor(to: string, path: string): string {
    const message = [...this.messages].reverse().find((m) => m.to === to && m.text.includes(path));
    const match = message?.text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`));
    if (!match?.[1]) throw new Error(`No email to ${to} containing ${path}`);
    return decodeURIComponent(match[1]);
  }
}

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: IdentityConfig;
  readonly emails: CapturedEmails;
  /** Owner-role pool for arranging and inspecting state behind the application's back. */
  readonly db: pg.Pool;
  readonly http: () => ReturnType<typeof request>;
  /** Signs a token with the service's real key, for expiry and claim-manipulation tests. */
  signAccessToken(
    claims: Record<string, unknown>,
    times: { iat: number; exp: number },
  ): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
  const config = loadConfig(envSchema, {
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: inject('appDatabaseUrl'),
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    RABBITMQ_URL:
      process.env.TEST_RABBITMQ_URL ?? 'amqp://solmira:solmira_dev_password@localhost:5672',
    JWT_PRIVATE_KEY: await exportPKCS8(privateKey),
    JWT_PUBLIC_KEY: await exportSPKI(publicKey),
    COOKIE_SECURE: 'false',
    APP_URL: 'http://solmira.test',
    ...env,
  });
  const emails = new CapturedEmails();
  const app = await createServiceApp(AppModule.register(config, { emailSender: emails }), {
    serviceName: SERVICE_NAME,
    nodeEnv: 'test',
  });
  await app.init();
  const db = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });

  return {
    app,
    config,
    emails,
    db,
    http: () => request(app.getHttpServer()),
    signAccessToken: (claims, times) => sign(privateKey, config, claims, times),
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}

function sign(
  key: CryptoKey,
  config: IdentityConfig,
  { sub, ...claims }: Record<string, unknown>,
  times: { iat: number; exp: number },
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(String(sub))
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt(times.iat)
    .setExpirationTime(times.exp)
    .sign(key);
}
