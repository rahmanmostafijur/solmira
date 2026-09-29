import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import type { z } from 'zod';

export const SERVICE_NAME = 'analytics-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4004),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,
});

export type AnalyticsConfig = z.infer<typeof envSchema>;
