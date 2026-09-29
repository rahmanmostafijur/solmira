import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'operations-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4002),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,

  // Access tokens are verified with the key identity-service publishes. This service never
  // holds a private signing key.
  IDENTITY_JWKS_URL: z.url().default('http://localhost:4001/api/v1/auth/.well-known/jwks.json'),
  /** identity-service base URL for server-to-server calls (member lookups, token relay). */
  IDENTITY_INTERNAL_URL: z.url().default('http://localhost:4001'),
  JWT_ISSUER: z.string().min(1).default('solmira-identity'),
  JWT_AUDIENCE: z.string().min(1).default('solmira-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

  // Object storage (S3 API). Locally MinIO; in AWS, S3 with credentials from the task role
  // (leave the key variables unset) and no endpoint override.
  S3_BUCKET: z.string().min(3).default('solmira-media'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  /** Endpoint the service talks to (e.g. http://minio:9000). Omit for AWS S3. */
  S3_ENDPOINT: z.url().optional(),
  /** Endpoint written into signed URLs for browsers, if it differs (e.g. http://localhost:9000). */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  IMAGE_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
});

export type OperationsConfig = z.infer<typeof envSchema>;
