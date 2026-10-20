import { Inject, Injectable } from '@nestjs/common';
import type {
  ApiKey,
  ApiKeyListQuery,
  CreateApiKeyRequest,
  CreatedApiKey,
} from '@solmira/contracts';
import { NotFoundError, offsetOf, pageOf, type TenantAuthContext } from '@solmira/service-kit';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { findApplication } from '../applications/applications.service.js';
import { Database } from '../database/database.module.js';
import { apiKeys } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { generateApiKey } from './api-key-material.js';

type ApiKeyRow = typeof apiKeys.$inferSelect;

export function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as ApiKey['scopes'],
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** The key itself is in this response and nowhere else: only its digest is stored. */
  create(
    auth: TenantAuthContext,
    applicationId: string,
    input: CreateApiKeyRequest,
  ): Promise<CreatedApiKey> {
    const material = generateApiKey();
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      const [row] = await tx
        .insert(apiKeys)
        .values({
          id: uuidv7(),
          organizationId: auth.organizationId,
          applicationId,
          name: input.name,
          prefix: material.prefix,
          keyHash: material.hash,
          scopes: input.scopes,
          createdBy: auth.userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning();
      await recordEvent(tx, auth, 'api_key.created', {
        apiKeyId: row!.id,
        applicationId,
        prefix: row!.prefix,
        scopes: input.scopes,
      });
      return { ...toApiKey(row!), key: material.key };
    });
  }

  list(auth: TenantAuthContext, applicationId: string, query: ApiKeyListQuery) {
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId, { includeArchived: true });
      const revokedFilter: SQL | undefined = query.includeRevoked
        ? undefined
        : isNull(apiKeys.revokedAt);
      const where = and(
        eq(apiKeys.organizationId, auth.organizationId),
        eq(apiKeys.applicationId, applicationId),
        revokedFilter,
      );
      const [{ total = 0 } = {}] = await tx.select({ total: count() }).from(apiKeys).where(where);
      const rows = await tx
        .select()
        .from(apiKeys)
        .where(where)
        .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      return pageOf(rows.map(toApiKey), total, query);
    });
  }

  /** Idempotent: revoking a revoked key keeps the original revocation time. */
  revoke(auth: TenantAuthContext, applicationId: string, id: string): Promise<void> {
    return this.database.forTenant(auth, async (tx) => {
      const [row] = await tx
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.organizationId, auth.organizationId),
            eq(apiKeys.applicationId, applicationId),
            eq(apiKeys.id, id),
          ),
        );
      if (!row) throw new NotFoundError('API key not found');
      if (row.revokedAt) return;
      await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.organizationId, auth.organizationId), eq(apiKeys.id, id)));
      await recordEvent(tx, auth, 'api_key.revoked', { apiKeyId: id, applicationId });
    });
  }
}
