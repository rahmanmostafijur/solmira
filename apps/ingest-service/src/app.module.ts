import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule, PlatformModule, platformOptionsFromEnv } from '@solmira/service-kit';
import { SERVICE_NAME, type IngestConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { IngestCoreModule, type IngestAdapters } from './ingest-core.module.js';
import { WebhookResourcesModule } from './webhook-resources.module.js';

function platformOptions(config: IngestConfig, adapters: IngestAdapters) {
  const options = platformOptionsFromEnv(SERVICE_NAME, config);
  return adapters.logStream
    ? { ...options, logging: { ...options.logging, stream: adapters.logStream } }
    : options;
}

/**
 * Modular monolith root. Feature modules (applications, endpoints, message ingestion) are added
 * as the phases land; they share one database and its transaction boundary.
 */
@Module({})
export class AppModule {
  static register(config: IngestConfig, adapters: IngestAdapters = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(platformOptions(config, adapters)),
        // Verification key from identity's JWKS endpoint: no key material in this service.
        AuthModule.forRoot({
          jwksUrl: config.IDENTITY_JWKS_URL,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        }),
        IngestCoreModule.register(config, adapters),
        DatabaseModule,
        WebhookResourcesModule,
      ],
    };
  }
}
