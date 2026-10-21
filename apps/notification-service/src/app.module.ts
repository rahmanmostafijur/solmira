import { Module, type DynamicModule } from '@nestjs/common';
import {
  AuthModule,
  EventConsumersModule,
  PlatformModule,
  platformOptionsFromEnv,
} from '@solmira/service-kit';
import { SERVICE_NAME, type NotificationConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { EndpointAlertsConsumer } from './notifications/endpoint-alerts.consumer.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { FeedConsumer } from './realtime/feed.consumer.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { RealtimeHub } from './realtime/realtime.hub.js';

@Module({})
class NotificationsModule {
  static register(config: NotificationConfig): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        EndpointAlertsConsumer,
        {
          provide: RealtimeHub,
          useValue: new RealtimeHub({
            maxPerOrganization: config.REALTIME_MAX_CONNECTIONS_PER_ORGANIZATION,
            maxBufferedBytes: config.REALTIME_MAX_BUFFERED_BYTES,
          }),
        },
        FeedConsumer,
        RealtimeGateway,
      ],
    };
  }
}

@Module({})
export class AppModule {
  static register(config: NotificationConfig): DynamicModule {
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
        NotificationsModule.register(config),
      ],
    };
  }
}
