import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { EventConsumerHost } from '@solmira/service-kit';
import { ENDPOINT_ALERTS_CONSUMER, NotificationsService } from './notifications.service.js';

/** Listens for the events that should reach a tenant as notifications. */
@Injectable()
export class EndpointAlertsConsumer implements OnModuleInit {
  constructor(
    @Inject(EventConsumerHost) private readonly consumers: EventConsumerHost,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.consumers.register({
      queue: ENDPOINT_ALERTS_CONSUMER,
      patterns: ['endpoint.auto_disabled'],
      handler: (event) => this.notifications.onEndpointAutoDisabled(event),
    });
  }
}
