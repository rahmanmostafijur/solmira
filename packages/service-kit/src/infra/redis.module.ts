import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { HealthRegistry } from '../health/health.registry.js';

export const REDIS = Symbol('REDIS');

export interface RedisOptions {
  readonly url: string;
  readonly connectionName: string;
}

const MAX_RECONNECT_DELAY_MS = 5_000;
const logger = new Logger('Redis');

export function createRedisClient({ url, connectionName }: RedisOptions): Redis {
  const client = new Redis(url, {
    connectionName,
    lazyConnect: true,
    // Fail fast instead of queueing commands while disconnected: callers (cache, rate limiter)
    // decide how to degrade, rather than requests hanging until Redis comes back.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    retryStrategy: (attempt) => Math.min(attempt * 200, MAX_RECONNECT_DELAY_MS),
  });
  client.on('error', (error: Error) => logger.warn({ err: error }, 'Redis connection error'));
  return client;
}

@Injectable()
class RedisLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  onModuleInit(): void {
    this.health.register('redis', () => this.redis.ping());
    // Start even when Redis is down; readiness reports it and ioredis keeps reconnecting.
    this.redis.connect().catch((error: unknown) => {
      logger.warn({ err: error }, 'Initial Redis connection failed; retrying in background');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

@Module({})
export class RedisModule {
  static forRoot(options: RedisOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      providers: [{ provide: REDIS, useFactory: () => createRedisClient(options) }, RedisLifecycle],
      exports: [REDIS],
    };
  }
}
