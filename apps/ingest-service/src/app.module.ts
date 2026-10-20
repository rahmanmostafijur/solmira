import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule, PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { SERVICE_NAME, type IngestConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';

/**
 * Modular monolith root. Feature modules (applications, endpoints, message ingestion) are added
 * as the phases land; they share one database and its transaction boundary.
 */
@Module({})
export class AppModule {
  static register(config: IngestConfig): DynamicModule {
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
        DatabaseModule,
      ],
    };
  }
}
