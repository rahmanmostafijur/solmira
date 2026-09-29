import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import type { z } from 'zod';

export const SERVICE_NAME = 'identity-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4001),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,
});

export type IdentityConfig = z.infer<typeof envSchema>;
