import { Inject, Injectable } from '@nestjs/common';
import {
  EndpointUrlError,
  ValidationError,
  assertSafeEndpointUrl,
  type AddressResolver,
} from '@solmira/service-kit';
import type { IngestConfig } from '../config.js';
import { ADDRESS_RESOLVER, INGEST_CONFIG } from '../ingest.tokens.js';

/** Applies the endpoint URL policy (ADR-0028) and reports a rejection as a field error. */
@Injectable()
export class EndpointUrlValidator {
  constructor(
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
    @Inject(ADDRESS_RESOLVER) private readonly resolve: AddressResolver,
  ) {}

  async assertAllowed(url: string): Promise<string> {
    try {
      const parsed = await assertSafeEndpointUrl(url, {
        production: this.config.NODE_ENV === 'production',
        allowPrivateTargets: this.config.ALLOW_PRIVATE_ENDPOINT_TARGETS,
        resolve: this.resolve,
      });
      return parsed.toString();
    } catch (error) {
      if (error instanceof EndpointUrlError)
        throw new ValidationError([{ path: 'url', message: error.message }]);
      throw error;
    }
  }
}
