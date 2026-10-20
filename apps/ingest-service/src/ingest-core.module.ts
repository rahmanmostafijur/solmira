import { Module, type DynamicModule } from '@nestjs/common';
import {
  LocalSecretCipher,
  resolveAddresses,
  type AddressResolver,
  type DestinationStream,
  type SecretCipher,
} from '@solmira/service-kit';
import type { IngestConfig } from './config.js';
import { ADDRESS_RESOLVER, INGEST_CONFIG, SECRET_CIPHER } from './ingest.tokens.js';

/** Replaceable collaborators, so tests can fake DNS without touching the network. */
export interface IngestAdapters {
  readonly resolver?: AddressResolver;
  readonly cipher?: SecretCipher;
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
        { provide: ADDRESS_RESOLVER, useValue: adapters.resolver ?? resolveAddresses },
        {
          provide: SECRET_CIPHER,
          useValue:
            adapters.cipher ??
            new LocalSecretCipher(config.SECRETS_ENCRYPTION_KEY, config.SECRETS_ENCRYPTION_KEY_ID),
        },
      ],
      exports: [INGEST_CONFIG, ADDRESS_RESOLVER, SECRET_CIPHER],
    };
  }
}
