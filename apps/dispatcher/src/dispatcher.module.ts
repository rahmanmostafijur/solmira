import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnModuleInit,
} from '@nestjs/common';
import {
  HealthRegistry,
  LocalSecretCipher,
  PG_POOL,
  REDIS,
  type Redis,
  assertRowLevelSecurityEnforced,
  resolveAddresses,
  type AddressResolver,
  type SecretCipher,
} from '@solmira/service-kit';
import type pg from 'pg';
import type { DispatcherConfig } from './config.js';
import { EndpointRateLimiter } from './delivery/endpoint-rate-limiter.js';
import { DeliveryRepository } from './database/delivery-repository.js';
import { DeliveryProcessor } from './delivery/delivery-processor.js';
import { HttpSender } from './delivery/http-sender.js';
import { DispatcherService } from './dispatcher.service.js';
import {
  ADDRESS_RESOLVER,
  ATTEMPT_STORE,
  DELIVERY_PROCESSOR,
  DELIVERY_REPOSITORY,
  DISPATCHER_CONFIG,
  ENDPOINT_RATE_LIMITER,
  HTTP_SENDER,
  SECRET_CIPHER,
} from './dispatcher.tokens.js';
import {
  AttemptStore,
  assertAttemptTable,
  createDynamoClients,
  ensureAttemptTable,
} from '@solmira/attempt-history';

/** Replaceable collaborators, so tests can fake DNS without touching the network. */
export interface DispatcherAdapters {
  readonly resolver?: AddressResolver;
}

const HISTORY_WRITE_TRIES = 3;

@Injectable()
class DispatcherHealth implements OnModuleInit {
  private readonly logger = new Logger('DispatcherHealth');

  constructor(
    @Inject(HealthRegistry) private readonly health: HealthRegistry,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(DISPATCHER_CONFIG) private readonly config: DispatcherConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    this.health.register('row-level-security', () => assertRowLevelSecurityEnforced(this.pool));
    const { raw } = createDynamoClients({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(this.config.DYNAMODB_ENDPOINT ? { endpoint: this.config.DYNAMODB_ENDPOINT } : {}),
    });
    // History is derived data and delivery continues without it, so this never fails readiness.
    this.health.register('dynamodb', () => assertAttemptTable(raw, this.config.DYNAMODB_TABLE), {
      critical: false,
    });
    if (!this.config.DYNAMODB_CREATE_TABLE) return;
    try {
      await ensureAttemptTable(raw, this.config.DYNAMODB_TABLE);
    } catch (error) {
      // The worker still delivers without its history; readiness reports the gap.
      this.logger.warn({ err: error }, 'Could not create the attempt history table');
    }
  }
}

@Module({})
export class DispatcherModule {
  static register(config: DispatcherConfig, adapters: DispatcherAdapters = {}): DynamicModule {
    const dynamo = createDynamoClients({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
    });
    return {
      module: DispatcherModule,
      providers: [
        { provide: DISPATCHER_CONFIG, useValue: config },
        { provide: ADDRESS_RESOLVER, useValue: adapters.resolver ?? resolveAddresses },
        {
          provide: SECRET_CIPHER,
          useValue: new LocalSecretCipher(
            config.SECRETS_ENCRYPTION_KEY,
            config.SECRETS_ENCRYPTION_KEY_ID,
          ),
        },
        {
          provide: ATTEMPT_STORE,
          useValue: new AttemptStore(
            dynamo.documents,
            config.DYNAMODB_TABLE,
            config.ATTEMPT_RETENTION_DAYS,
          ),
        },
        {
          provide: HTTP_SENDER,
          inject: [ADDRESS_RESOLVER],
          useFactory: (resolve: AddressResolver) =>
            new HttpSender({
              connectTimeoutMs: config.DELIVERY_CONNECT_TIMEOUT_MS,
              timeoutMs: config.DELIVERY_TIMEOUT_MS,
              responseBodyLimitBytes: config.DELIVERY_RESPONSE_BODY_LIMIT_BYTES,
              production: config.NODE_ENV === 'production',
              allowPrivateTargets: config.ALLOW_PRIVATE_ENDPOINT_TARGETS,
              resolve,
            }),
        },
        {
          provide: DELIVERY_REPOSITORY,
          inject: [PG_POOL],
          useFactory: (pool: pg.Pool) =>
            new DeliveryRepository(pool, {
              circuitFailureThreshold: config.CIRCUIT_FAILURE_THRESHOLD,
              circuitCooldownBaseSeconds: config.CIRCUIT_COOLDOWN_BASE_SECONDS,
              circuitCooldownMaxSeconds: config.CIRCUIT_COOLDOWN_MAX_SECONDS,
              autoDisableAfterHours: config.AUTO_DISABLE_AFTER_HOURS,
            }),
        },
        {
          provide: ENDPOINT_RATE_LIMITER,
          inject: [{ token: REDIS, optional: true }],
          useFactory: (redis: Redis | undefined) => new EndpointRateLimiter(redis),
        },
        {
          provide: DELIVERY_PROCESSOR,
          inject: [
            DELIVERY_REPOSITORY,
            HTTP_SENDER,
            ATTEMPT_STORE,
            SECRET_CIPHER,
            ENDPOINT_RATE_LIMITER,
          ],
          useFactory: (
            repository: DeliveryRepository,
            sender: HttpSender,
            attempts: AttemptStore,
            cipher: SecretCipher,
            limiter: EndpointRateLimiter,
          ) =>
            new DeliveryProcessor(
              repository,
              sender,
              attempts,
              cipher,
              {
                retry: {
                  schedule: config.RETRY_SCHEDULE_SECONDS,
                  jitterRatio: config.RETRY_JITTER_RATIO,
                },
                maxPayloadBytes: config.DELIVERY_MAX_PAYLOAD_BYTES,
                historyWriteTries: HISTORY_WRITE_TRIES,
              },
              limiter,
            ),
        },
        DispatcherHealth,
        DispatcherService,
      ],
      exports: [DispatcherService],
    };
  }
}
