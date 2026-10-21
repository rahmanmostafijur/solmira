import { loadConfig } from '@solmira/service-kit';
import { describe, expect, it } from 'vitest';
import { envSchema } from './config.js';

const KMS_KEY = 'arn:aws:kms:eu-west-1:123456789012:key/11111111-2222-3333-4444-555555555555';
const local = Buffer.alloc(32, 7).toString('base64');
const connections = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://u:p@localhost:5672',
};
const base = { ...connections, SECRETS_ENCRYPTION_KEY: local };
const production = { ...connections, NODE_ENV: 'production', SECRETS_KMS_KEY_ID: KMS_KEY };

describe('ingest-service configuration', () => {
  it('refuses to start without a key source, or with a local key that is not 32 bytes', () => {
    expect(() => loadConfig(envSchema, connections)).toThrow('SECRETS_ENCRYPTION_KEY');
    expect(() =>
      loadConfig(envSchema, {
        ...base,
        SECRETS_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
      }),
    ).toThrow('SECRETS_ENCRYPTION_KEY');
  });

  it('takes exactly one key source, and a KMS key only as a full ARN', () => {
    expect(() => loadConfig(envSchema, { ...base, SECRETS_KMS_KEY_ID: KMS_KEY })).toThrow(
      'SECRETS_KMS_KEY_ID',
    );
    expect(() =>
      loadConfig(envSchema, { ...connections, SECRETS_KMS_KEY_ID: 'alias/solmira' }),
    ).toThrow('SECRETS_KMS_KEY_ID');
    expect(
      loadConfig(envSchema, { ...connections, SECRETS_KMS_KEY_ID: KMS_KEY }).SECRETS_KMS_KEY_ID,
    ).toBe(KMS_KEY);
  });

  it('refuses a local key in production and accepts KMS there', () => {
    expect(() => loadConfig(envSchema, { ...base, NODE_ENV: 'production' })).toThrow(
      'SECRETS_ENCRYPTION_KEY',
    );
    expect(loadConfig(envSchema, production).NODE_ENV).toBe('production');
  });

  it('allows private endpoint targets in development and refuses them in production', () => {
    const development = loadConfig(envSchema, {
      ...base,
      NODE_ENV: 'development',
      ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true',
    });
    expect(development.ALLOW_PRIVATE_ENDPOINT_TARGETS).toBe(true);
    expect(() =>
      loadConfig(envSchema, { ...production, ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true' }),
    ).toThrow('ALLOW_PRIVATE_ENDPOINT_TARGETS');
    expect(loadConfig(envSchema, production).ALLOW_PRIVATE_ENDPOINT_TARGETS).toBe(false);
  });
});
