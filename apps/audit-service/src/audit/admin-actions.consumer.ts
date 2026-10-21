import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AUDITED_EVENT_TYPES } from '@solmira/contracts';
import { EventConsumerHost } from '@solmira/service-kit';
import { ADMIN_ACTIONS_CONSUMER, AuditService } from './audit.service.js';

/** Listens for exactly the event types the audit policy says are administrative actions. */
@Injectable()
export class AdminActionsConsumer implements OnModuleInit {
  constructor(
    @Inject(EventConsumerHost) private readonly consumers: EventConsumerHost,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.consumers.register({
      queue: ADMIN_ACTIONS_CONSUMER,
      patterns: AUDITED_EVENT_TYPES,
      handler: (event) => this.audit.record(event),
    });
  }
}
