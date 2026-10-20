import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import {
  DEFAULT_IDEMPOTENCY_RETENTION_SECONDS,
  DEFAULT_MAX_MESSAGE_PAYLOAD_BYTES,
} from '@solmira/contracts';
import { z } from 'zod';

export const SERVICE_NAME = 'ingest-service';

const KEY_ENCRYPTION_KEY_BYTES = 32;

export const envSchema = baseEnvSchema
  .extend({
    PORT: portSchema(4002),
    ...postgresEnvSchema.shape,
    ...redisEnvSchema.shape,
    ...rabbitmqEnvSchema.shape,

    // Access tokens are verified with the key identity-service publishes. This service never
    // holds a private signing key.
    IDENTITY_JWKS_URL: z.url().default('http://localhost:4001/api/v1/auth/.well-known/jwks.json'),
    JWT_ISSUER: z.string().min(1).default('solmira-identity'),
    JWT_AUDIENCE: z.string().min(1).default('solmira-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

    /**
     * Key-encryption key for signing secrets (ADR-0026): 32 random bytes, base64. In AWS this is
     * replaced by KMS; locally it comes from the environment.
     */
    SECRETS_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === KEY_ENCRYPTION_KEY_BYTES,
        'Must be 32 bytes, base64 encoded (openssl rand -base64 32)',
      ),
    /** Names the key that wrapped a secret, so keys can be rotated later. */
    SECRETS_ENCRYPTION_KEY_ID: z.string().min(1).max(64).default('local-1'),

    /** Largest accepted message payload, in bytes of its JSON form. The body limit is 1 MB. */
    MAX_MESSAGE_PAYLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1_000_000)
      .default(DEFAULT_MAX_MESSAGE_PAYLOAD_BYTES),
    /** How long an Idempotency-Key is remembered (ADR-0030). */
    IDEMPOTENCY_RETENTION_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(30 * 24 * 3600)
      .default(DEFAULT_IDEMPOTENCY_RETENTION_SECONDS),
    /** Ingestion requests allowed per API key per minute. */
    INGEST_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(600),
    /** Published outbox rows older than this are removed by the maintenance job. */
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    /** Outbox relay: rows per pass and pause between passes when the outbox is empty. */
    OUTBOX_RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    OUTBOX_RELAY_POLL_MS: z.coerce.number().int().min(10).max(60_000).default(500),

    /** Development and tests only: lets endpoints target http and non-public addresses. */
    ALLOW_PRIVATE_ENDPOINT_TARGETS: z.stringbool().default(false),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.ALLOW_PRIVATE_ENDPOINT_TARGETS), {
    path: ['ALLOW_PRIVATE_ENDPOINT_TARGETS'],
    message: 'Must not be enabled in production',
  });

export type IngestConfig = z.infer<typeof envSchema>;
