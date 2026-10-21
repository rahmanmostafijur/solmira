import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CachingSecretCipher } from './caching-secret-cipher.js';
import { KmsSecretCipher } from './kms-secret-cipher.js';
import { LocalSecretCipher } from './secret-cipher.js';
import {
  createSecretCipher,
  secretCipherEnvShape,
  secretCipherProblems,
  type SecretCipherEnv,
} from './secret-cipher-config.js';
import { z } from 'zod';

const KMS = 'arn:aws:kms:eu-west-1:123456789012:key/11111111-2222-3333-4444-555555555555';
const local = randomBytes(32).toString('base64');
const base: SecretCipherEnv = {
  NODE_ENV: 'development',
  SECRETS_ENCRYPTION_KEY_ID: 'local-1',
  SECRETS_KMS_PREVIOUS_KEY_IDS: '',
  SECRETS_CACHE_TTL_SECONDS: 60,
};

describe('secretCipherProblems', () => {
  it('accepts a local key outside production and a KMS key anywhere', () => {
    expect(secretCipherProblems({ ...base, SECRETS_ENCRYPTION_KEY: local })).toEqual([]);
    expect(secretCipherProblems({ ...base, SECRETS_KMS_KEY_ID: KMS })).toEqual([]);
    expect(
      secretCipherProblems({ ...base, NODE_ENV: 'production', SECRETS_KMS_KEY_ID: KMS }),
    ).toEqual([]);
  });

  it('refuses a local key in production', () => {
    const problems = secretCipherProblems({
      ...base,
      NODE_ENV: 'production',
      SECRETS_ENCRYPTION_KEY: local,
    });
    expect(problems.map(([path]) => path)).toContain('SECRETS_ENCRYPTION_KEY');
  });

  it('requires exactly one source', () => {
    expect(secretCipherProblems(base)).not.toEqual([]);
    expect(
      secretCipherProblems({ ...base, SECRETS_ENCRYPTION_KEY: local, SECRETS_KMS_KEY_ID: KMS }),
    ).not.toEqual([]);
  });
});

describe('the settings schema', () => {
  const schema = z.object(secretCipherEnvShape);

  it('takes only a full key ARN for KMS, never an alias or a bare id', () => {
    expect(schema.safeParse({ SECRETS_KMS_KEY_ID: KMS }).success).toBe(true);
    expect(schema.safeParse({ SECRETS_KMS_KEY_ID: 'alias/solmira-secrets' }).success).toBe(false);
    expect(
      schema.safeParse({ SECRETS_KMS_KEY_ID: '11111111-2222-3333-4444-555555555555' }).success,
    ).toBe(false);
  });

  it('takes only a 32-byte local key', () => {
    expect(schema.safeParse({ SECRETS_ENCRYPTION_KEY: local }).success).toBe(true);
    expect(schema.safeParse({ SECRETS_ENCRYPTION_KEY: 'c2hvcnQ=' }).success).toBe(false);
  });
});

describe('createSecretCipher', () => {
  it('builds the local cipher for a local key', () => {
    expect(createSecretCipher({ ...base, SECRETS_ENCRYPTION_KEY: local })).toBeInstanceOf(
      LocalSecretCipher,
    );
  });

  it('builds a cached KMS cipher, or an uncached one when the cache is off', () => {
    const kms = { ...base, SECRETS_KMS_KEY_ID: KMS };
    expect(createSecretCipher(kms)).toBeInstanceOf(CachingSecretCipher);
    expect(createSecretCipher({ ...kms, SECRETS_CACHE_TTL_SECONDS: 0 })).toBeInstanceOf(
      KmsSecretCipher,
    );
  });
});
