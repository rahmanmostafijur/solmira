import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'analytics-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4004),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,

  // Access tokens are verified with the key identity-service publishes.
  IDENTITY_JWKS_URL: z.url().default('http://localhost:4001/api/v1/auth/.well-known/jwks.json'),
  JWT_ISSUER: z.string().min(1).default('solmira-identity'),
  JWT_AUDIENCE: z.string().min(1).default('solmira-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

  /** Attempts are kept this long; it must cover the longest range a report can ask for. */
  ANALYTICS_RETENTION_DAYS: z.coerce.number().int().min(32).max(3650).default(35),
});

export type AnalyticsConfig = z.infer<typeof envSchema>;
