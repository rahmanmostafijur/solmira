import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { eventEnvelopeSchema } from '@solmira/contracts';
import { EVENTS_EXCHANGE, RabbitMqConnection, assertEventExchanges } from '@solmira/service-kit';
import type { Channel } from 'amqplib';
import { FEED_EVENT_TYPES, toRealtimeEvent } from './feed-events.js';
import { RealtimeHub } from './realtime.hub.js';

/**
 * Feeds the hub from the event exchange. Each instance has its own exclusive, auto-delete queue,
 * so every instance sees every event and forwards it to the clients connected to it. The feed is
 * live only: nothing is stored here, and an event that arrives while no client listens is dropped.
 */
@Injectable()
export class FeedConsumer implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('RealtimeFeed');
  private channel: Channel | undefined;

  constructor(
    @Inject(RabbitMqConnection) private readonly connection: RabbitMqConnection,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  onModuleInit(): void {
    this.connection.onConnected(() => this.attach());
  }

  async onApplicationShutdown(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
  }

  private async attach(): Promise<void> {
    const channel = await this.connection.createChannel();
    channel.on('error', (error: Error) =>
      this.logger.warn({ err: error }, 'Realtime feed channel error'),
    );
    await assertEventExchanges(channel);
    const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
    for (const type of FEED_EVENT_TYPES) await channel.bindQueue(queue, EVENTS_EXCHANGE, type);
    await channel.consume(
      queue,
      (message) => {
        if (!message) return;
        this.forward(message.content);
      },
      { noAck: true },
    );
    this.channel = channel;
  }

  private forward(content: Buffer): void {
    try {
      const envelope = eventEnvelopeSchema.safeParse(JSON.parse(content.toString('utf8')));
      if (!envelope.success) return;
      const event = toRealtimeEvent(envelope.data);
      if (event && envelope.data.organizationId) {
        this.hub.broadcast(envelope.data.organizationId, event);
      }
    } catch (error) {
      // A malformed message is not worth a retry: the feed is best effort and live only.
      this.logger.warn({ err: error }, 'Ignored an unreadable event');
    }
  }
}
