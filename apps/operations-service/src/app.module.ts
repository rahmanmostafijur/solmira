import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule, PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { CatalogModule } from './catalog.module.js';
import { SERVICE_NAME, type OperationsConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { OperationsCoreModule, type OperationsAdapters } from './operations-core.module.js';

/**
 * Modular monolith root. Catalog master data (phase 3) is the first feature module; inventory,
 * purchasing, orders and fulfillment follow as separate modules that share one database and its
 * transaction boundary.
 */
@Module({})
export class AppModule {
  static register(config: OperationsConfig, adapters: OperationsAdapters = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(platformOptionsFromEnv(SERVICE_NAME, config)),
        // Verification key from identity's JWKS endpoint: no key material in this service.
        AuthModule.forRoot({
          jwksUrl: config.IDENTITY_JWKS_URL,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        }),
        OperationsCoreModule.register(config, adapters),
        DatabaseModule,
        CatalogModule,
      ],
    };
  }
}
