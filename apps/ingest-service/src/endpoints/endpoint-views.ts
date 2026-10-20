import type { Endpoint } from '@solmira/contracts';
import { NotFoundError, ValidationError, type TenantAuthContext } from '@solmira/service-kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { IngestTransaction } from '../database/database.module.js';
import { endpointEventTypes, endpoints, eventTypes } from '../database/schema.js';

type EndpointRow = typeof endpoints.$inferSelect;

export function toEndpoint(row: EndpointRow, eventTypeIds: string[]): Endpoint {
  return {
    id: row.id,
    applicationId: row.applicationId,
    url: row.url,
    description: row.description,
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    rateLimitPerSecond: row.rateLimitPerSecond,
    headers: row.headers as Record<string, string>,
    eventTypeIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** Event type ids per endpoint; an endpoint without rows receives every event type. */
export async function subscriptionsOf(
  tx: IngestTransaction,
  endpointIds: string[],
): Promise<Map<string, string[]>> {
  const byEndpoint = new Map<string, string[]>();
  if (endpointIds.length === 0) return byEndpoint;
  const rows = await tx
    .select({
      endpointId: endpointEventTypes.endpointId,
      eventTypeId: endpointEventTypes.eventTypeId,
    })
    .from(endpointEventTypes)
    .where(inArray(endpointEventTypes.endpointId, endpointIds));
  for (const row of rows)
    byEndpoint.set(row.endpointId, [...(byEndpoint.get(row.endpointId) ?? []), row.eventTypeId]);
  return byEndpoint;
}

export async function replaceSubscriptions(
  tx: IngestTransaction,
  auth: TenantAuthContext,
  endpointId: string,
  eventTypeIds: string[],
): Promise<void> {
  await tx.delete(endpointEventTypes).where(eq(endpointEventTypes.endpointId, endpointId));
  if (eventTypeIds.length === 0) return;
  await tx.insert(endpointEventTypes).values(
    eventTypeIds.map((eventTypeId) => ({
      organizationId: auth.organizationId,
      endpointId,
      eventTypeId,
    })),
  );
}

/** Every id must name a live event type of this organization; otherwise a field error. */
export async function assertSubscribable(
  tx: IngestTransaction,
  auth: TenantAuthContext,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.organizationId, auth.organizationId),
        inArray(eventTypes.id, ids),
        isNull(eventTypes.archivedAt),
      ),
    );
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.findIndex((id) => !found.has(id));
  if (missing >= 0)
    throw new ValidationError([
      { path: `eventTypeIds.${missing}`, message: 'Event type not found or archived' },
    ]);
}

/** The endpoint of this application and organization, or 404. `live` also hides archived ones. */
export async function findEndpoint(
  tx: IngestTransaction,
  auth: TenantAuthContext,
  applicationId: string,
  id: string,
  options: { live: boolean } = { live: false },
): Promise<EndpointRow> {
  const [row] = await tx
    .select()
    .from(endpoints)
    .where(
      and(
        eq(endpoints.organizationId, auth.organizationId),
        eq(endpoints.applicationId, applicationId),
        eq(endpoints.id, id),
      ),
    );
  if (!row || (options.live && row.archivedAt)) throw new NotFoundError('Endpoint not found');
  return row;
}
