import { Module, type DynamicModule } from '@nestjs/common';
import {
  AuthModule,
  EventConsumersModule,
  PlatformModule,
  platformOptionsFromEnv,
} from '@solmira/service-kit';
import { AdminActionsConsumer } from './audit/admin-actions.consumer.js';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { MaintenanceService } from './audit/maintenance.service.js';
import { AUDIT_CONFIG } from './audit.tokens.js';
import { SERVICE_NAME, type AuditConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';

@Module({})
class AuditModule {
  static register(config: AuditConfig): DynamicModule {
    return {
      module: AuditModule,
      controllers: [AuditController],
      providers: [
        { provide: AUDIT_CONFIG, useValue: config },
        AuditService,
        AdminActionsConsumer,
        MaintenanceService,
      ],
    };
  }
}

@Module({})
export class AppModule {
  static register(config: AuditConfig): DynamicModule {
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
        AuditModule.register(config),
      ],
    };
  }
}
