import { Logger } from '@nestjs/common';
import { MetricsRegistry, secretContext, withSpan, type SecretCipher } from '@solmira/service-kit';
import type {
  ClaimedDelivery,
  DeliveryContext,
  DeliveryRepository,
  Outcome,
} from '../database/delivery-repository.js';
import type { AttemptStore } from '@solmira/attempt-history';
import type { EndpointRateLimiter } from './endpoint-rate-limiter.js';
import { buildDeliveryRequest } from './delivery-request.js';
import type { HttpSender, SendResult } from './http-sender.js';
import { nextAttempt, type RetryPolicy } from './retry-schedule.js';

export interface ProcessorOptions {
  readonly retry: RetryPolicy;
  readonly maxPayloadBytes: number;
  /** How many times a history write is tried before the loss is logged. */
  readonly historyWriteTries: number;
}

export interface Processed {
  readonly outcome: Outcome['kind'] | 'deferred';
  readonly sent: boolean;
  readonly errorClass: string | null;
}

const HISTORY_RETRY_DELAY_MS = 100;
const RESULT_OF = { succeeded: 'succeeded', retry: 'retrying', failed: 'failed' } as const;
/** How long a delivery waits when its secret cannot be decrypted right now. */
const SECRET_RETRY_DELAY_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Takes one claimed delivery from loading to a recorded outcome (ADR-0031). The order of effects
 * matters: send, write the attempt to the history, then advance the delivery in PostgreSQL. A
 * crash anywhere repeats the same attempt number, with the same webhook id.
 */
export class DeliveryProcessor {
  private readonly logger = new Logger('DeliveryProcessor');

  constructor(
    private readonly repository: DeliveryRepository,
    private readonly sender: HttpSender,
    private readonly attempts: AttemptStore,
    private readonly cipher: SecretCipher,
    private readonly options: ProcessorOptions,
    private readonly limiter: EndpointRateLimiter,
    private readonly clock: () => Date = () => new Date(),
    private readonly metrics: MetricsRegistry = new MetricsRegistry({
      enabled: false,
      serviceName: 'dispatcher',
    }),
  ) {}

  /** One delivery attempt as a span: ids and the outcome, never the URL, payload or response. */
  process(claimed: ClaimedDelivery): Promise<Processed> {
    return withSpan(
      'delivery.attempt',
      {
        'organization.id': claimed.organizationId,
        'endpoint.id': claimed.endpointId,
        'message.id': claimed.messageId,
        'delivery.id': claimed.deliveryId,
        'delivery.attempt': claimed.attempt,
      },
      async (span) => {
        const processed = await this.processDelivery(claimed);
        span.setAttribute('delivery.outcome', processed.outcome);
        if (processed.errorClass) span.setAttribute('delivery.error_class', processed.errorClass);
        return processed;
      },
    );
  }

  private async processDelivery(claimed: ClaimedDelivery): Promise<Processed> {
    const context = await this.repository.loadContext(claimed);
    const refusal = context ? this.refusalFor(context) : 'delivery_data_missing';
    if (!context || refusal) return this.giveUp(claimed, refusal ?? 'delivery_data_missing');

    const secrets = await this.decryptSecrets(claimed, context);
    if (secrets === null) {
      this.metrics.count('SecretDecryptFailures');
      this.metrics.count('DeliveriesDeferred', 1, { Reason: 'secret' });
      await this.repository.defer(
        claimed,
        new Date(this.clock().getTime() + SECRET_RETRY_DELAY_MS),
      );
      return { outcome: 'deferred', sent: false, errorClass: null };
    }
    if (secrets.length === 0) return this.giveUp(claimed, 'signing_secret_missing');

    const decision = await this.limiter.tryAcquire(claimed.endpointId, context.rateLimitPerSecond);
    if (!decision.allowed) {
      // Over the endpoint's rate limit: wait for the next window, no attempt is counted.
      this.metrics.count('DeliveriesDeferred', 1, { Reason: 'rate_limit' });
      await this.repository.defer(
        claimed,
        new Date(this.clock().getTime() + decision.retryAfterMs),
      );
      return { outcome: 'deferred', sent: false, errorClass: null };
    }

    const startedAt = this.clock();
    const request = buildDeliveryRequest({
      messageId: claimed.messageId,
      payload: context.payload,
      customHeaders: context.headers,
      secrets,
      now: startedAt,
    });
    const result = await this.sender.send({
      url: context.url,
      headers: request.headers,
      body: request.body,
    });

    const outcome = this.outcomeOf(claimed, result);
    await this.writeHistory(claimed, startedAt, result, outcome);
    await this.repository.recordOutcome(claimed, outcome, {
      startedAt,
      durationMs: result.durationMs,
    });
    this.metrics.count('Attempts', 1, { Result: RESULT_OF[outcome.kind] });
    this.metrics.observe('AttemptDuration', result.durationMs, 'Milliseconds');
    return { outcome: outcome.kind, sent: true, errorClass: result.errorClass };
  }

  private refusalFor(context: DeliveryContext): string | null {
    if (context.archived || !context.enabled) return 'endpoint_unavailable';
    const bytes = Buffer.byteLength(JSON.stringify(context.payload), 'utf8');
    return bytes > this.options.maxPayloadBytes ? 'payload_too_large' : null;
  }

  private async decryptSecrets(
    claimed: ClaimedDelivery,
    context: DeliveryContext,
  ): Promise<string[] | null> {
    const where = secretContext(claimed.organizationId, claimed.endpointId);
    // The active secret signs first; during a rotation the previous one signs as well.
    const ordered = [...context.secrets].sort((a, b) =>
      a.status === b.status ? 0 : a.status === 'active' ? -1 : 1,
    );
    try {
      return await Promise.all(ordered.map((secret) => this.cipher.decrypt(secret, where)));
    } catch (error) {
      // The key service is unreachable or throttling, or a secret cannot be opened. Nothing was
      // sent, so the delivery waits and no attempt is counted; the failure is logged (never the
      // secret) and an alarm watches for it.
      this.logger.error(
        { err: error, deliveryId: claimed.deliveryId, endpointId: claimed.endpointId },
        'Could not decrypt the signing secret; the delivery is deferred',
      );
      return null;
    }
  }

  private outcomeOf(claimed: ClaimedDelivery, result: SendResult): Outcome {
    if (result.ok && result.statusCode !== null)
      return { kind: 'succeeded', statusCode: result.statusCode };
    const errorClass = result.errorClass ?? 'network';
    const next = nextAttempt(this.options.retry, claimed.attempt - claimed.cycleBase, this.clock());
    return next.exhausted
      ? { kind: 'failed', statusCode: result.statusCode, errorClass }
      : { kind: 'retry', at: next.at, statusCode: result.statusCode, errorClass };
  }

  /** A permanent refusal: nothing was sent, so there is no attempt to record in the history. */
  private async giveUp(claimed: ClaimedDelivery, errorClass: string): Promise<Processed> {
    await this.repository.recordOutcome(claimed, { kind: 'failed', statusCode: null, errorClass });
    return { outcome: 'failed', sent: false, errorClass };
  }

  private async writeHistory(
    claimed: ClaimedDelivery,
    startedAt: Date,
    result: SendResult,
    outcome: Outcome,
  ): Promise<void> {
    const record = {
      organizationId: claimed.organizationId,
      messageId: claimed.messageId,
      endpointId: claimed.endpointId,
      deliveryId: claimed.deliveryId,
      attempt: claimed.attempt,
      startedAt,
      durationMs: result.durationMs,
      statusCode: result.statusCode,
      errorClass: result.errorClass,
      responseBody: result.responseBody,
      responseBodyTruncated: result.responseBodyTruncated,
      nextAttemptAt: outcome.kind === 'retry' ? outcome.at : null,
    };
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.attempts.record(record);
        return;
      } catch (error) {
        if (attempt >= this.options.historyWriteTries) {
          // History is derived data: the delivery state below stays correct (ADR-0032).
          this.logger.error(
            { err: error, deliveryId: claimed.deliveryId, attempt: claimed.attempt },
            'Could not record the delivery attempt in the history',
          );
          return;
        }
        await sleep(HISTORY_RETRY_DELAY_MS * attempt);
      }
    }
  }
}
