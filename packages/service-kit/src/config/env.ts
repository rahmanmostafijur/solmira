import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const portSchema = (defaultPort: number) =>
  z.coerce.number().int().min(1).max(65_535).default(defaultPort);

/** Variables every service needs. Services extend this with their own schema. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
});

export const postgresEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export const rabbitmqEnvSchema = z.object({
  RABBITMQ_URL: z.url({ protocol: /^amqps?$/ }),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type PostgresEnv = z.infer<typeof postgresEnvSchema>;
export type RedisEnv = z.infer<typeof redisEnvSchema>;
export type RabbitmqEnv = z.infer<typeof rabbitmqEnvSchema>;
