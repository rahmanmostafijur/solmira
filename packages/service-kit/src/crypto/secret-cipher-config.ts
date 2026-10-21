import { z } from 'zod';
import { AwsKeyManagement } from './aws-key-management.js';
import { CachingSecretCipher } from './caching-secret-cipher.js';
import { KmsSecretCipher } from './kms-secret-cipher.js';
import { LocalSecretCipher, type SecretCipher } from './secret-cipher.js';

const KEY_ENCRYPTION_KEY_BYTES = 32;
const KMS_KEY_ARN = /^arn:aws[a-z-]*:kms:[a-z0-9-]+:\d{12}:key\/[A-Za-z0-9-]+$/;
const DEFAULT_CACHE_TTL_SECONDS = 60;

/**
 * Where signing secrets are encrypted (ADR-0026, ADR-0038), shared by every service that reads or
 * writes them. Development uses a local key; production uses a KMS key and refuses the local one.
 */
export const secretCipherEnvShape = {
  /** Development and tests: 32 random bytes, base64. */
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => Buffer.from(value, 'base64').length === KEY_ENCRYPTION_KEY_BYTES,
      'Must be 32 bytes, base64 encoded (openssl rand -base64 32)',
    )
    .optional(),
  /** Names the local key, so it can be rotated later. */
  SECRETS_ENCRYPTION_KEY_ID: z.string().min(1).max(64).default('local-1'),
  /** AWS KMS: the ARN of the key that wraps data keys. */
  SECRETS_KMS_KEY_ID: z.string().regex(KMS_KEY_ARN, 'Must be the ARN of a KMS key').optional(),
  /** Earlier KMS keys whose secrets can still be read, comma separated ARNs (after a key change). */
  SECRETS_KMS_PREVIOUS_KEY_IDS: z.string().default(''),
  /** How long a decrypted secret stays in memory (KMS only; 0 turns the cache off). */
  SECRETS_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(DEFAULT_CACHE_TTL_SECONDS),
};

export interface SecretCipherEnv {
  readonly NODE_ENV: string;
  readonly SECRETS_ENCRYPTION_KEY?: string | undefined;
  readonly SECRETS_ENCRYPTION_KEY_ID: string;
  readonly SECRETS_KMS_KEY_ID?: string | undefined;
  readonly SECRETS_KMS_PREVIOUS_KEY_IDS: string;
  readonly SECRETS_CACHE_TTL_SECONDS: number;
}

/** Problems with the combination of settings, as `[path, message]`; empty when the settings are valid. */
export function secretCipherProblems(env: SecretCipherEnv): [string, string][] {
  const problems: [string, string][] = [];
  const hasLocal = env.SECRETS_ENCRYPTION_KEY !== undefined;
  const hasKms = env.SECRETS_KMS_KEY_ID !== undefined;
  if (hasLocal && hasKms) {
    problems.push([
      'SECRETS_KMS_KEY_ID',
      'Set either SECRETS_ENCRYPTION_KEY or SECRETS_KMS_KEY_ID, not both',
    ]);
  } else if (!hasLocal && !hasKms) {
    problems.push([
      'SECRETS_ENCRYPTION_KEY',
      'A key is required: SECRETS_ENCRYPTION_KEY or SECRETS_KMS_KEY_ID',
    ]);
  }
  if (env.NODE_ENV === 'production' && hasLocal) {
    problems.push([
      'SECRETS_ENCRYPTION_KEY',
      'A local key is not allowed in production; use SECRETS_KMS_KEY_ID',
    ]);
  }
  return problems;
}

/**
 * Builds the cipher the settings ask for. Call only after the settings passed `secretCipherProblems`.
 * KMS credentials and region come from the environment (the task role and AWS_REGION in ECS).
 */
export function createSecretCipher(env: SecretCipherEnv): SecretCipher {
  if (env.SECRETS_KMS_KEY_ID) {
    const previous = env.SECRETS_KMS_PREVIOUS_KEY_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const kms = new KmsSecretCipher(
      new AwsKeyManagement({
        keyId: env.SECRETS_KMS_KEY_ID,
        acceptedKeyIds: previous,
      }),
    );
    return env.SECRETS_CACHE_TTL_SECONDS > 0
      ? new CachingSecretCipher(kms, {
          ttlMs: env.SECRETS_CACHE_TTL_SECONDS * 1000,
          maxEntries: 10_000,
        })
      : kms;
  }
  return new LocalSecretCipher(env.SECRETS_ENCRYPTION_KEY!, env.SECRETS_ENCRYPTION_KEY_ID);
}
