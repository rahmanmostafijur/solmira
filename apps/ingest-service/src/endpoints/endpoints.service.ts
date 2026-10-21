import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateEndpointRequest,
  CreatedEndpoint,
  Endpoint,
  EndpointListQuery,
  UpdateEndpointRequest,
} from '@solmira/contracts';
import {
  offsetOf,
  pageOf,
  secretContext,
  type SecretCipher,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, count, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { findApplication } from '../applications/applications.service.js';
import { Database } from '../database/database.module.js';
import { endpointSecrets, endpoints } from '../database/schema.js';
import { SECRET_CIPHER } from '../ingest.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import { generateSigningSecret } from '../secrets/signing-secret.js';
import { EndpointUrlValidator } from './endpoint-url-validator.js';
import {
  assertSubscribable,
  findEndpoint,
  replaceSubscriptions,
  subscriptionsOf,
  toEndpoint,
} from './endpoint-views.js';

const changedFields = (input: object) =>
  Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);

@Injectable()
export class EndpointsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(EndpointUrlValidator) private readonly urls: EndpointUrlValidator,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
  ) {}

  /** Creates the endpoint and its signing secret; the secret is returned this once. */
  async create(
    auth: TenantAuthContext,
    applicationId: string,
    input: CreateEndpointRequest,
  ): Promise<CreatedEndpoint> {
    const url = await this.urls.assertAllowed(input.url);
    const signingSecret = generateSigningSecret();
    const id = uuidv7();
    // Encrypted before the transaction: the key service is a network call, and no connection should
    // be held while waiting for it.
    const encrypted = await this.cipher.encrypt(
      signingSecret,
      secretContext(auth.organizationId, id),
    );
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      await assertSubscribable(tx, auth, input.eventTypeIds);
      const [row] = await tx
        .insert(endpoints)
        .values({
          id,
          organizationId: auth.organizationId,
          applicationId,
          url,
          description: input.description ?? null,
          enabled: input.enabled,
          disabledReason: input.enabled ? null : 'manual',
          disabledAt: input.enabled ? null : new Date(),
          rateLimitPerSecond: input.rateLimitPerSecond ?? null,
          headers: input.headers,
        })
        .returning();
      await replaceSubscriptions(tx, auth, id, input.eventTypeIds);
      await tx.insert(endpointSecrets).values({
        id: uuidv7(),
        organizationId: auth.organizationId,
        endpointId: id,
        status: 'active',
        ...encrypted,
      });
      await recordEvent(tx, auth, 'endpoint.created', { endpointId: id, applicationId });
      return { ...toEndpoint(row!, input.eventTypeIds), signingSecret };
    });
  }

  list(auth: TenantAuthContext, applicationId: string, query: EndpointListQuery) {
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId, { includeArchived: true });
      const archivedFilter: SQL | undefined = query.includeArchived
        ? undefined
        : isNull(endpoints.archivedAt);
      const where = and(
        eq(endpoints.organizationId, auth.organizationId),
        eq(endpoints.applicationId, applicationId),
        archivedFilter,
      );
      const [{ total = 0 } = {}] = await tx.select({ total: count() }).from(endpoints).where(where);
      const rows = await tx
        .select()
        .from(endpoints)
        .where(where)
        .orderBy(desc(endpoints.createdAt), desc(endpoints.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const subscriptions = await subscriptionsOf(
        tx,
        rows.map((row) => row.id),
      );
      const items = rows.map((row) => toEndpoint(row, subscriptions.get(row.id) ?? []));
      return pageOf(items, total, query);
    });
  }

  get(auth: TenantAuthContext, applicationId: string, id: string): Promise<Endpoint> {
    return this.database.forTenant(auth, async (tx) => {
      const row = await findEndpoint(tx, auth, applicationId, id);
      const subscriptions = await subscriptionsOf(tx, [id]);
      return toEndpoint(row, subscriptions.get(id) ?? []);
    });
  }

  async update(
    auth: TenantAuthContext,
    applicationId: string,
    id: string,
    input: UpdateEndpointRequest,
  ): Promise<Endpoint> {
    const url = input.url === undefined ? undefined : await this.urls.assertAllowed(input.url);
    return this.database.forTenant(auth, async (tx) => {
      const current = await findEndpoint(tx, auth, applicationId, id, { live: true });
      if (input.eventTypeIds) await assertSubscribable(tx, auth, input.eventTypeIds);
      const enabling = input.enabled === true && !current.enabled;
      const disabling = input.enabled === false && current.enabled;
      const [row] = await tx
        .update(endpoints)
        .set({
          ...(url !== undefined ? { url } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.rateLimitPerSecond !== undefined
            ? { rateLimitPerSecond: input.rateLimitPerSecond }
            : {}),
          ...(input.headers !== undefined ? { headers: input.headers } : {}),
          ...(enabling
            ? {
                enabled: true,
                disabledReason: null,
                disabledAt: null,
                // A fresh start: the owner fixed the receiver (ADR-0033).
                consecutiveFailures: 0,
                firstFailureAt: null,
                circuitOpenUntil: null,
                circuitTrips: 0,
              }
            : {}),
          ...(disabling
            ? { enabled: false, disabledReason: 'manual', disabledAt: new Date() }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(endpoints.organizationId, auth.organizationId), eq(endpoints.id, id)))
        .returning();
      if (input.eventTypeIds) await replaceSubscriptions(tx, auth, id, input.eventTypeIds);
      await recordEvent(tx, auth, 'endpoint.updated', {
        endpointId: id,
        applicationId,
        fields: changedFields(input),
      });
      const subscriptions = await subscriptionsOf(tx, [id]);
      return toEndpoint(row!, subscriptions.get(id) ?? []);
    });
  }

  /** Idempotent archive; the secret stays encrypted at rest for the delivery history. */
  archive(auth: TenantAuthContext, applicationId: string, id: string): Promise<void> {
    return this.database.forTenant(auth, async (tx) => {
      const current = await findEndpoint(tx, auth, applicationId, id);
      if (current.archivedAt) return;
      await tx
        .update(endpoints)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(endpoints.organizationId, auth.organizationId), eq(endpoints.id, id)));
      await recordEvent(tx, auth, 'endpoint.archived', { endpointId: id, applicationId });
    });
  }

  /**
   * Idempotent restore. The URL passes the URL policy again, as at creation: the policy or the
   * host's addresses may have changed while the endpoint was archived. The enabled flag, the
   * subscriptions and the delivery history stay as they were; failed deliveries stay failed.
   */
  async restore(auth: TenantAuthContext, applicationId: string, id: string): Promise<Endpoint> {
    const archived = await this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      return findEndpoint(tx, auth, applicationId, id);
    });
    if (!archived.archivedAt) return this.get(auth, applicationId, id);
    // Checked before the transaction: resolving the host is a network call.
    await this.urls.assertAllowed(archived.url);
    return this.database.forTenant(auth, async (tx) => {
      await findApplication(tx, auth, applicationId);
      // Only an archived row is updated, so a concurrent restore is recorded once.
      const [restored] = await tx
        .update(endpoints)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(endpoints.organizationId, auth.organizationId),
            eq(endpoints.id, id),
            isNotNull(endpoints.archivedAt),
          ),
        )
        .returning();
      if (restored)
        await recordEvent(tx, auth, 'endpoint.restored', { endpointId: id, applicationId });
      const row = restored ?? (await findEndpoint(tx, auth, applicationId, id));
      const subscriptions = await subscriptionsOf(tx, [id]);
      return toEndpoint(row, subscriptions.get(id) ?? []);
    });
  }
}
