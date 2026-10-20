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
  JWT_ISSUER: z.string().min(1).default('solmira-identity'),
  JWT_AUDIENCE: z.string().min(1).default('solmira-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
});

export type OperationsConfig = z.infer<typeof envSchema>;
