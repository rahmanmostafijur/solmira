import { Inject, Injectable } from '@nestjs/common';
import type { ApiKeyScope } from '@solmira/contracts';
import { PG_POOL } from '@solmira/service-kit';
import type pg from 'pg';
import { hashApiKey, isWellFormedApiKey } from './api-key-material.js';

/** Who a valid API key stands for. The tenant comes from the key's own record. */
export interface ApiKeyPrincipal {
  readonly apiKeyId: string;
  readonly organizationId: string;
  readonly applicationId: string;
  readonly scopes: readonly ApiKeyScope[];
}

interface AuthenticationRow {
  api_key_id: string;
  organization_id: string;
  application_id: string;
  scopes: ApiKeyScope[];
}

/**
 * Resolves a presented key to its principal (ADR-0027). It goes through the database function
 * authenticate_api_key, the only path that reads keys without a tenant, and it also records the
 * key's last use. The HTTP guard that calls it arrives with message ingestion.
 */
@Injectable()
export class ApiKeyAuthenticator {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async authenticate(presented: string): Promise<ApiKeyPrincipal | null> {
    if (!isWellFormedApiKey(presented)) return null;
    const { rows } = await this.pool.query<AuthenticationRow>(
      'select * from authenticate_api_key($1)',
      [hashApiKey(presented)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      apiKeyId: row.api_key_id,
      organizationId: row.organization_id,
      applicationId: row.application_id,
      scopes: row.scopes,
    };
  }
}
