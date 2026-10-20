import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';
import { RabbitMqConnection } from '../infra/rabbitmq.module.js';
import {
  DEFAULT_PREFETCH,
  DEFAULT_RETRY_DELAY_MS,
  processMessage,
  type EventConsumerDefinition,
} from './event-consumer.js';
import { assertConsumerQueues, assertEventExchanges } from './topology.js';

/** Consumers declare their queues before the relay publishes, so no event meets a missing queue. */
const CONSUMER_ORDER = 0;

/**
 * Runs the consumers a service registers. Each consumer gets its own channel, declared topology
 * and prefetch limit; after a reconnect everything is rebuilt.
 */
@Injectable()
export class EventConsumerHost implements OnApplicationShutdown {
  private readonly logger = new Logger('EventConsumers');
  private readonly definitions: EventConsumerDefinition[] = [];
  private channels: ConfirmChannel[] = [];
  private listening = false;

  constructor(@Inject(RabbitMqConnection) private readonly connection: RabbitMqConnection) {}

  /** Call during module initialization, before the application finishes bootstrapping. */
  register(definition: EventConsumerDefinition): void {
    if (this.definitions.some((existing) => existing.queue === definition.queue))
      throw new Error('Consumer queue registered twice: ' + definition.queue);
    this.definitions.push(definition);
    if (!this.listening) {
      this.listening = true;
      this.connection.onConnected(() => this.attachAll(), CONSUMER_ORDER);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const closing = this.channels
      .splice(0)
      .map((channel) => channel.close().catch(() => undefined));
    await Promise.all(closing);
  }

  private async attachAll(): Promise<void> {
    this.channels = [];
    for (const definition of this.definitions) this.channels.push(await this.attach(definition));
  }

  private async attach(definition: EventConsumerDefinition): Promise<ConfirmChannel> {
    const channel = await this.connection.createConfirmChannel();
    channel.on('error', (error: Error) =>
      this.logger.warn({ err: error, queue: definition.queue }, 'Consumer channel error'),
    );
    await assertEventExchanges(channel);
    await assertConsumerQueues(channel, {
      queue: definition.queue,
      patterns: definition.patterns,
      retryDelayMs: definition.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    });
    await channel.prefetch(definition.prefetch ?? DEFAULT_PREFETCH);
    await channel.consume(definition.queue, (message) => {
      if (!message) return; // the broker cancelled this consumer; the next reconnect re-attaches
      void processMessage(channel, definition, message, (error, attempt, willRetry) =>
        this.logger.warn(
          { err: error, queue: definition.queue, attempt, willRetry },
          willRetry ? 'Event handler failed; will retry' : 'Event handler failed; dead-lettering',
        ),
      ).catch((error: unknown) => {
        // Acknowledging failed (channel closed): the broker redelivers, the handler is idempotent.
        this.logger.warn({ err: error, queue: definition.queue }, 'Could not settle a delivery');
      });
    });
    return channel;
  }
}

@Module({})
export class EventConsumersModule {
  static forRoot(): DynamicModule {
    return {
      module: EventConsumersModule,
      global: true,
      providers: [EventConsumerHost],
      exports: [EventConsumerHost],
    };
  }
}
