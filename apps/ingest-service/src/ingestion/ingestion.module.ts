import { Module } from '@nestjs/common';
import { WebhookResourcesModule } from '../webhook-resources.module.js';
import { FanOutService } from '../fan-out/fan-out.service.js';
import { MaintenanceService } from '../maintenance.service.js';
import { OutboxMetrics } from '../outbox-metrics.service.js';
import { PayloadValidator } from '../event-types/payload-validator.js';
import { ApiKeyGuard } from './api-key-auth.js';
import { ApiKeyRateLimiter } from './api-key-rate-limiter.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

/** Message ingestion (API key authenticated), fan-out to endpoints, and housekeeping (Phase 5). */
@Module({
  imports: [WebhookResourcesModule],
  controllers: [MessagesController],
  providers: [
    ApiKeyGuard,
    ApiKeyRateLimiter,
    MessagesService,
    PayloadValidator,
    FanOutService,
    MaintenanceService,
    OutboxMetrics,
  ],
  exports: [FanOutService, MaintenanceService],
})
export class IngestionModule {}
