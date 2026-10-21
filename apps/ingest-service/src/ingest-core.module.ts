import { Module, type DynamicModule } from '@nestjs/common';
import { AttemptStore, createDynamoClients } from '@solmira/attempt-history';
import {
  createSecretCipher,
  resolveAddresses,
  type AddressResolver,
  type DestinationStream,
  type SecretCipher,
} from '@solmira/service-kit';
import type { IngestConfig } from './config.js';
import { ADDRESS_RESOLVER, ATTEMPT_STORE, INGEST_CONFIG, SECRET_CIPHER } from './ingest.tokens.js';

/** Replaceable collaborators, so tests can fake DNS without touching the network. */
export interface IngestAdapters {
  readonly resolver?: AddressResolver;
  readonly cipher?: SecretCipher;
  readonly attempts?: AttemptStore;
  /** Captures log output in tests. */
  readonly logStream?: DestinationStream;
}

/** Configuration and outbound adapters shared by every feature module. */
@Module({})
export class IngestCoreModule {
  static register(config: IngestConfig, adapters: IngestAdapters = {}): DynamicModule {
    return {
      module: IngestCoreModule,
      global: true,
      providers: [
        { provide: INGEST_CONFIG, useValue: config },
        {
          provide: ATTEMPT_STORE,
          useValue:
            adapters.attempts ??
            new AttemptStore(
              createDynamoClients({
                region: config.AWS_REGION,
                ...(config.DYNAMODB_ENDPOINT ? { endpoint: config.DYNAMODB_ENDPOINT } : {}),
              }).documents,
              config.DYNAMODB_TABLE,
              30,
            ),
        },
        { provide: ADDRESS_RESOLVER, useValue: adapters.resolver ?? resolveAddresses },
        {
          provide: SECRET_CIPHER,
          useValue: adapters.cipher ?? createSecretCipher(config),
        },
      ],
      exports: [INGEST_CONFIG, ADDRESS_RESOLVER, SECRET_CIPHER, ATTEMPT_STORE],
    };
  }
}
