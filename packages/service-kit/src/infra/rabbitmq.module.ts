import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import amqp from 'amqplib';
import { HealthRegistry } from '../health/health.registry.js';

/** Runs after every successful (re)connect. Listeners with a lower `order` run first. */
export type ConnectionListener = (connection: RabbitMqConnection) => Promise<void>;

export interface RabbitMqOptions {
  readonly url: string;
  readonly connectionName: string;
}

const RABBITMQ_OPTIONS = Symbol('RABBITMQ_OPTIONS');
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Exponential backoff with jitter so a broker restart is not followed by a synchronized reconnect storm. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * Owns the single AMQP connection of a service and keeps it alive. amqplib does not reconnect
 * on its own, so every close (broker restart, network blip) schedules a new attempt.
 * Channels, publishers and consumers are layered on top: components register with `onConnected`
 * and rebuild their channels and topology every time the connection is (re)established.
 */
@Injectable()
export class RabbitMqConnection implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('RabbitMQ');
  private connection: amqp.ChannelModel | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private attempt = 0;
  private closing = false;
  private readonly listeners: { order: number; listener: ConnectionListener }[] = [];

  constructor(
    @Inject(RABBITMQ_OPTIONS) private readonly options: RabbitMqOptions,
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
  ) {}

  get isConnected(): boolean {
    return this.connection !== undefined;
  }

  /**
   * Registers a component that needs channels. It is called right away when the connection is
   * already up, and again after every reconnect, so channels never outlive their connection.
   */
  onConnected(listener: ConnectionListener, order = 0): void {
    this.listeners.push({ order, listener });
    this.listeners.sort((a, b) => a.order - b.order);
    if (this.connection) void this.notify([{ order, listener }]);
  }

  async createChannel(): Promise<amqp.Channel> {
    return this.requireConnection().createChannel();
  }

  async createConfirmChannel(): Promise<amqp.ConfirmChannel> {
    return this.requireConnection().createConfirmChannel();
  }

  private requireConnection(): amqp.ChannelModel {
    if (!this.connection) throw new Error('RabbitMQ is not connected');
    return this.connection;
  }

  private async notify(targets: { order: number; listener: ConnectionListener }[]): Promise<void> {
    for (const { listener } of targets) {
      try {
        await listener(this);
      } catch (error) {
        this.logger.warn({ err: error }, 'RabbitMQ connection listener failed');
      }
    }
  }

  onModuleInit(): void {
    this.health.register('rabbitmq', async () => {
      if (!this.connection) throw new Error('not connected');
    });
    void this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    clearTimeout(this.reconnectTimer);
    await this.connection?.close().catch(() => undefined);
    this.connection = undefined;
  }

  private async connect(): Promise<void> {
    try {
      const connection = await amqp.connect(this.options.url, {
        clientProperties: { connection_name: this.options.connectionName },
      });
      connection.on('error', (error: Error) =>
        this.logger.warn({ err: error }, 'RabbitMQ connection error'),
      );
      connection.on('close', () => this.handleClose());
      this.connection = connection;
      this.attempt = 0;
      this.logger.log('Connected to RabbitMQ');
      await this.notify([...this.listeners]);
    } catch (error) {
      this.logger.warn({ err: error }, 'RabbitMQ connection attempt failed');
      this.scheduleReconnect();
    }
  }

  private handleClose(): void {
    this.connection = undefined;
    if (!this.closing) {
      this.logger.warn('RabbitMQ connection closed; reconnecting');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closing) return;
    const delay = reconnectDelay(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
    this.reconnectTimer.unref();
  }
}

@Module({})
export class RabbitMqModule {
  static forRoot(options: RabbitMqOptions): DynamicModule {
    return {
      module: RabbitMqModule,
      global: true,
      providers: [{ provide: RABBITMQ_OPTIONS, useValue: options }, RabbitMqConnection],
      exports: [RabbitMqConnection],
    };
  }
}
