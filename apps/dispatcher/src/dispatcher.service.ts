import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { DispatcherConfig } from './config.js';
import type { ClaimedDelivery, DeliveryRepository } from './database/delivery-repository.js';
import type { DeliveryProcessor } from './delivery/delivery-processor.js';
import { DELIVERY_PROCESSOR, DELIVERY_REPOSITORY, DISPATCHER_CONFIG } from './dispatcher.tokens.js';

const ERROR_BACKOFF_MS = 2_000;
const SHUTDOWN_GRACE_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

/**
 * The worker loop (ADR-0031): claim a batch when there is capacity, process each delivery without
 * waiting for the others, sleep only when nothing is due, and when every slot is busy wait for the
 * first one to free up. Capacity is the number of deliveries in flight; the claim asks for no more
 * than is free, so a slow receiver cannot make the worker take work it cannot start.
 */
@Injectable()
export class DispatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Dispatcher');
  private readonly inFlight = new Set<Promise<void>>();
  private stopped = false;
  private loop: Promise<void> | undefined;

  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(DELIVERY_PROCESSOR) private readonly processor: DeliveryProcessor,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.DISPATCH_AUTOSTART) this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    await this.loop;
    await Promise.race([Promise.allSettled([...this.inFlight]), sleep(SHUTDOWN_GRACE_MS)]);
  }

  /** Claims what is due and waits until all of it is processed. Used by tests. */
  async drainOnce(): Promise<number> {
    const claimed = await this.claimBatch(this.config.DISPATCH_CONCURRENCY);
    await Promise.allSettled(claimed.map((delivery) => this.start(delivery)));
    return claimed.length;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const free = this.config.DISPATCH_CONCURRENCY - this.inFlight.size;
        if (free <= 0) {
          // Every slot is busy: wake as soon as one finishes, not after a fixed pause (a pause
          // would cap throughput at slots per pause however fast the receivers answer).
          await Promise.race([...this.inFlight, sleep(this.config.DISPATCH_POLL_MS)]);
          continue;
        }
        const claimed = await this.claimBatch(free);
        for (const delivery of claimed) void this.start(delivery);
        // Something was due, so more may be: claim again at once. Only an empty claim waits.
        if (claimed.length === 0) await sleep(this.config.DISPATCH_POLL_MS);
      } catch (error) {
        this.logger.warn({ err: error }, 'Claiming deliveries failed; retrying');
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  private claimBatch(capacity: number): Promise<ClaimedDelivery[]> {
    return this.repository.claim(
      Math.min(capacity, this.config.DISPATCH_BATCH_SIZE),
      this.config.DISPATCH_PER_TENANT_BATCH,
      this.config.DISPATCH_PER_ENDPOINT,
      this.config.DISPATCH_LEASE_SECONDS,
    );
  }

  private start(delivery: ClaimedDelivery): Promise<void> {
    const work = this.processor
      .process(delivery)
      .then(() => undefined)
      .catch((error: unknown) => {
        // The delivery keeps its lease and is claimed again when it expires: nothing is lost.
        this.logger.error(
          { err: error, deliveryId: delivery.deliveryId, attempt: delivery.attempt },
          'Processing a delivery failed; it will be retried after its lease expires',
        );
      })
      .finally(() => this.inFlight.delete(work));
    this.inFlight.add(work);
    return work;
  }
}
