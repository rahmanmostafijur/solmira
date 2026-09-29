import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import type { z } from 'zod';

export const SERVICE_NAME = 'operations-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4002),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,
});

export type OperationsConfig = z.infer<typeof envSchema>;
