import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
} from '@solmira/service-kit';
import type { z } from 'zod';

export const SERVICE_NAME = 'audit-service';

// No Redis: the audit service is a write-heavy event consumer with no cache or realtime needs.
export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4005),
  ...postgresEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,
});

export type AuditConfig = z.infer<typeof envSchema>;
