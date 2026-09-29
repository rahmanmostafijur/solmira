import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis.module.js';
import { AccessTokenVerifier, type AccessTokenVerifierOptions } from './access-token-verifier.js';
import { AuthGuard } from './auth.guard.js';
import { REVOCATION_STORE, RedisRevocationStore } from './revocation-store.js';

export type AuthModuleOptions = AccessTokenVerifierOptions & {
  readonly accessTokenTtlSeconds: number;
};

/** Registers the global AuthGuard. Requires the platform's RedisModule (revocation denylist). */
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      providers: [
        { provide: AccessTokenVerifier, useFactory: () => new AccessTokenVerifier(options) },
        {
          provide: REVOCATION_STORE,
          inject: [REDIS],
          useFactory: (redis: Redis) =>
            new RedisRevocationStore(redis, options.accessTokenTtlSeconds),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AccessTokenVerifier, REVOCATION_STORE],
    };
  }
}
