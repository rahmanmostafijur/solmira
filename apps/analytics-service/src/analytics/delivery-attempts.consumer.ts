import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { EventConsumerHost } from '@solmira/service-kit';
import { AnalyticsService, DELIVERY_ATTEMPTS_CONSUMER } from './analytics.service.js';

/** Feeds the statistics from the dispatcher's `delivery.attempted` events. */
@Injectable()
export class DeliveryAttemptsConsumer implements OnModuleInit {
  constructor(
    @Inject(EventConsumerHost) private readonly consumers: EventConsumerHost,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
  ) {}

  onModuleInit(): void {
    this.consumers.register({
      queue: DELIVERY_ATTEMPTS_CONSUMER,
      patterns: ['delivery.attempted'],
      handler: (event) => this.analytics.onDeliveryAttempted(event),
    });
  }
}
