import { Module, type DynamicModule } from '@nestjs/common';
import {
  AuthModule,
  EventConsumersModule,
  PlatformModule,
  platformOptionsFromEnv,
} from '@solmira/service-kit';
import { AnalyticsController } from './analytics/analytics.controller.js';
import { AnalyticsService } from './analytics/analytics.service.js';
import { DeliveryAttemptsConsumer } from './analytics/delivery-attempts.consumer.js';
import { MaintenanceService } from './analytics/maintenance.service.js';
import { ANALYTICS_CONFIG } from './analytics.tokens.js';
import { SERVICE_NAME, type AnalyticsConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';

@Module({})
class AnalyticsModule {
  static register(config: AnalyticsConfig): DynamicModule {
    return {
      module: AnalyticsModule,
      controllers: [AnalyticsController],
      providers: [
        { provide: ANALYTICS_CONFIG, useValue: config },
        AnalyticsService,
        DeliveryAttemptsConsumer,
        MaintenanceService,
      ],
      exports: [MaintenanceService],
    };
  }
}

@Module({})
export class AppModule {
  static register(config: AnalyticsConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        PlatformModule.forRoot(platformOptionsFromEnv(SERVICE_NAME, config)),
        AuthModule.forRoot({
          jwksUrl: config.IDENTITY_JWKS_URL,
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          accessTokenTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
        }),
        DatabaseModule,
        EventConsumersModule.forRoot(),
        AnalyticsModule.register(config),
      ],
    };
  }
}
