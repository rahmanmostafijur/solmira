import { loadConfig } from '@solmira/service-kit';
import { describe, expect, it } from 'vitest';
import { envSchema } from './config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://u:p@localhost:5672',
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('ingest-service configuration', () => {
  it('refuses to start without a key-encryption key of 32 bytes', () => {
    const { SECRETS_ENCRYPTION_KEY: _omitted, ...withoutKey } = base;
    expect(() => loadConfig(envSchema, withoutKey)).toThrow('SECRETS_ENCRYPTION_KEY');
    expect(() =>
      loadConfig(envSchema, {
        ...base,
        SECRETS_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
      }),
    ).toThrow('SECRETS_ENCRYPTION_KEY');
  });

  it('allows private endpoint targets in development and refuses them in production', () => {
    const development = loadConfig(envSchema, {
      ...base,
      NODE_ENV: 'development',
      ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true',
    });
    expect(development.ALLOW_PRIVATE_ENDPOINT_TARGETS).toBe(true);
    expect(() =>
      loadConfig(envSchema, {
        ...base,
        NODE_ENV: 'production',
        ALLOW_PRIVATE_ENDPOINT_TARGETS: 'true',
      }),
    ).toThrow('ALLOW_PRIVATE_ENDPOINT_TARGETS');
    expect(
      loadConfig(envSchema, { ...base, NODE_ENV: 'production' }).ALLOW_PRIVATE_ENDPOINT_TARGETS,
    ).toBe(false);
  });
});
