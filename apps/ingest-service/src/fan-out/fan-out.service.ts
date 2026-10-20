import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { EventEnvelope } from '@solmira/contracts';
import { EventConsumerHost } from '@solmira/service-kit';
import { sql } from 'drizzle-orm';
import { Database } from '../database/database.module.js';
import { processedEvents } from '../database/schema.js';

export const FAN_OUT_CONSUMER = 'ingest.fan-out';

/**
 * Creates one delivery per live, enabled endpoint of the message's application that is subscribed
 * to the message's event type, or that has no subscriptions and so receives everything (ADR-0030).
 * One set-based statement; `UNIQUE (message_id, endpoint_id)` makes repeating it harmless.
 */
@Injectable()
export class FanOutService implements OnModuleInit {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(EventConsumerHost) private readonly consumers: EventConsumerHost,
  ) {}

  onModuleInit(): void {
    this.consumers.register({
      queue: FAN_OUT_CONSUMER,
      patterns: ['message.created'],
      handler: (event) => this.handle(event),
    });
  }

  /** Applies one `message.created` event exactly once, however often the broker delivers it. */
  async handle(event: EventEnvelope): Promise<void> {
    const payload = event.payload as { messageId?: string } | null;
    if (!event.organizationId || typeof payload?.messageId !== 'string')
      throw new Error('message.created event without an organization or message id');
    const { organizationId } = event;
    const messageId = payload.messageId;

    await this.database.forTenant({ organizationId, userId: null }, async (tx) => {
      const claimed = await tx
        .insert(processedEvents)
        .values({ consumer: FAN_OUT_CONSUMER, eventId: event.eventId })
        .onConflictDoNothing()
        .returning({ eventId: processedEvents.eventId });
      if (claimed.length === 0) return;

      await tx.execute(sql`
        insert into deliveries (id, organization_id, application_id, message_id, endpoint_id)
        select uuidv7(), e.organization_id, e.application_id, m.id, e.id
          from messages m
          join endpoints e
            on e.organization_id = m.organization_id and e.application_id = m.application_id
         where m.organization_id = ${organizationId}
           and m.id = ${messageId}
           and e.archived_at is null
           and e.enabled
           and (
             not exists (select 1 from endpoint_event_types s where s.endpoint_id = e.id)
             or exists (
               select 1 from endpoint_event_types s
                where s.endpoint_id = e.id and s.event_type_id = m.event_type_id
             )
           )
        on conflict (message_id, endpoint_id) do nothing
      `);
    });
  }
}
