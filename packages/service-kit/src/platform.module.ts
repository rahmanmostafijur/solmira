import { Module, type DynamicModule } from '@nestjs/common';
import type { BaseEnv, PostgresEnv, RabbitmqEnv, RedisEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { PostgresModule } from './infra/postgres.module.js';
import { RabbitMqModule } from './infra/rabbitmq.module.js';
import { RedisModule } from './infra/redis.module.js';
import { createLoggerModule } from './logging/logger.module.js';

export interface PlatformOptions {
  readonly serviceName: string;
  readonly logging: { readonly level: string; readonly pretty: boolean };
  readonly postgres?: { readonly url: string; readonly poolMax: number };
  readonly redis?: { readonly url: string };
  readonly rabbitmq?: { readonly url: string };
}

type PlatformEnv = BaseEnv & Partial<PostgresEnv & RedisEnv & RabbitmqEnv>;

/** Derives platform options from a validated service config; absent URLs mean "not used". */
export function platformOptionsFromEnv(serviceName: string, env: PlatformEnv): PlatformOptions {
  return {
    serviceName,
    logging: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY },
    ...(env.DATABASE_URL
      ? { postgres: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX ?? 10 } }
      : {}),
    ...(env.REDIS_URL ? { redis: { url: env.REDIS_URL } } : {}),
    ...(env.RABBITMQ_URL ? { rabbitmq: { url: env.RABBITMQ_URL } } : {}),
  };
}

/**
 * Everything a service gets for free: structured logging, health endpoints and the
 * infrastructure clients it declares. Services import this once in their root module.
 */
@Module({})
export class PlatformModule {
  static forRoot(options: PlatformOptions): DynamicModule {
    const { serviceName } = options;
    return {
      module: PlatformModule,
      imports: [
        createLoggerModule({ serviceName, ...options.logging }),
        HealthModule.forRoot(serviceName),
        ...(options.postgres
          ? [PostgresModule.forRoot({ ...options.postgres, applicationName: serviceName })]
          : []),
        ...(options.redis
          ? [RedisModule.forRoot({ ...options.redis, connectionName: serviceName })]
          : []),
        ...(options.rabbitmq
          ? [RabbitMqModule.forRoot({ ...options.rabbitmq, connectionName: serviceName })]
          : []),
      ],
    };
  }
}
