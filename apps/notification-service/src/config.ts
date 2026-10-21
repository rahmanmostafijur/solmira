import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'notification-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4003),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,

  // Access tokens are verified with the key identity-service publishes.
  IDENTITY_JWKS_URL: z.url().default('http://localhost:4001/api/v1/auth/.well-known/jwks.json'),
  JWT_ISSUER: z.string().min(1).default('solmira-identity'),
  JWT_AUDIENCE: z.string().min(1).default('solmira-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

  /** Realtime feed limits (ADR-0035). */
  REALTIME_MAX_CONNECTIONS_PER_ORGANIZATION: z.coerce.number().int().min(1).max(10_000).default(50),
  /** A client more than this far behind is dropped instead of buffered without bound. */
  REALTIME_MAX_BUFFERED_BYTES: z.coerce.number().int().min(1024).default(1_048_576),
});

export type NotificationConfig = z.infer<typeof envSchema>;
