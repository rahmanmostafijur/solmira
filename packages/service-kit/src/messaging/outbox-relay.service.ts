import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';
import type pg from 'pg';
import { PG_POOL } from '../infra/postgres.module.js';
import { RabbitMqConnection } from '../infra/rabbitmq.module.js';
import { relayOutboxBatch } from './outbox-relay.js';
import { assertEventExchanges } from './topology.js';

export interface OutboxRelayOptions {
  /** Rows claimed per pass. */
  readonly batchSize: number;
  /** Pause between passes when the outbox is empty. */
  readonly pollIntervalMs: number;
}

const OUTBOX_RELAY_OPTIONS = Symbol('OUTBOX_RELAY_OPTIONS');
/** Channels are rebuilt after consumers declared their queues, so no event is published to nothing. */
const RELAY_ORDER = 10;
const ERROR_BACKOFF_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/** Publishes the service's outbox to RabbitMQ for as long as the application runs. */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OutboxRelay');
  private channel: ConfirmChannel | undefined;
  private stopped = false;
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(RabbitMqConnection) private readonly connection: RabbitMqConnection,
    @Inject(OUTBOX_RELAY_OPTIONS) private readonly options: OutboxRelayOptions,
  ) {}

  onApplicationBootstrap(): void {
    this.connection.onConnected(async () => {
      const channel = await this.connection.createConfirmChannel();
      channel.on('error', (error: Error) =>
        this.logger.warn({ err: error }, 'Relay channel error'),
      );
      channel.on('close', () => {
        if (this.channel === channel) this.channel = undefined;
      });
      await assertEventExchanges(channel);
      this.channel = channel;
    }, RELAY_ORDER);
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.loop;
    await this.channel?.close().catch(() => undefined);
  }

  /** One pass, for tests and for draining on demand. Returns how many events were published. */
  async runOnce(): Promise<number> {
    if (!this.channel) throw new Error('The relay has no RabbitMQ channel');
    const { published } = await relayOutboxBatch(this.pool, this.channel, this.options.batchSize);
    return published;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        if (this.channel && (await this.runOnce()) === this.options.batchSize) continue;
        await sleep(this.options.pollIntervalMs);
      } catch (error) {
        this.logger.warn({ err: error }, 'Outbox relay pass failed; retrying');
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }
}

@Module({})
export class OutboxRelayModule {
  static forRoot(options: Partial<OutboxRelayOptions> = {}): DynamicModule {
    return {
      module: OutboxRelayModule,
      providers: [
        {
          provide: OUTBOX_RELAY_OPTIONS,
          useValue: { batchSize: 100, pollIntervalMs: 500, ...options },
        },
        OutboxRelayService,
      ],
      exports: [OutboxRelayService],
    };
  }
}
