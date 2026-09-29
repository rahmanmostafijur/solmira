import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import type { z } from 'zod';

export const SERVICE_NAME = 'notification-service';

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4003),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,
});

export type NotificationConfig = z.infer<typeof envSchema>;
