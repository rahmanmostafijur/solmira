import { Inject, Injectable } from '@nestjs/common';
import {
  deliveryAttemptedPayloadSchema,
  type ApplicationReport,
  type ApplicationsReport,
  type DeliveryStats,
  type EventEnvelope,
} from '@solmira/contracts';
import type { TenantAuthContext } from '@solmira/service-kit';
import { sql } from 'drizzle-orm';
import { Database, type AnalyticsTransaction } from '../database/database.module.js';
import { deliveryAttempts, processedEvents } from '../database/schema.js';
import type { ResolvedRange } from './range.js';

export const DELIVERY_ATTEMPTS_CONSUMER = 'analytics.delivery-attempts';

type StatsRow = {
  readonly key: string | null;
  readonly attempts: number;
  readonly successful: number;
  readonly deliveries: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
};

/** The columns a report can group by. A fixed set, so no caller text reaches the SQL. */
type GroupBy = 'application_id' | 'endpoint_id' | null;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

function toStats(row: StatsRow | undefined): DeliveryStats {
  const attempts = row?.attempts ?? 0;
  const deliveries = row?.deliveries ?? 0;
  return {
    attempts,
    successfulAttempts: row?.successful ?? 0,
    successRate: attempts > 0 ? round((row?.successful ?? 0) / attempts, 4) : null,
    deliveries,
    attemptsPerDelivery: deliveries > 0 ? round(attempts / deliveries, 2) : null,
    latencyMs: { p50: row?.p50 ?? null, p95: row?.p95 ?? null, p99: row?.p99 ?? null },
  };
}

/**
 * Turns `delivery.attempted` events into rows and rows into figures (ADR-0035). Percentiles are
 * interpolated (percentile_cont) over the duration of every real send in the range.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** Idempotent: the event id is claimed in the same transaction that stores the attempt. */
  async onDeliveryAttempted(event: EventEnvelope): Promise<void> {
    const organizationId = event.organizationId;
    if (!organizationId) throw new Error('delivery.attempted without an organization');
    const parsed = deliveryAttemptedPayloadSchema.safeParse(event.payload);
    if (!parsed.success) throw new Error('delivery.attempted with an invalid payload');
    const payload = parsed.data;

    await this.database.forTenant({ organizationId, userId: null }, async (tx) => {
      const claimed = await tx
        .insert(processedEvents)
        .values({ consumer: DELIVERY_ATTEMPTS_CONSUMER, eventId: event.eventId })
        .onConflictDoNothing()
        .returning({ id: processedEvents.eventId });
      if (claimed.length === 0) return;
      await tx
        .insert(deliveryAttempts)
        .values({
          eventId: event.eventId,
          organizationId,
          applicationId: payload.applicationId,
          endpointId: payload.endpointId,
          deliveryId: payload.deliveryId,
          attempt: payload.attempt,
          result: payload.result,
          statusCode: payload.statusCode,
          errorClass: payload.errorClass,
          durationMs: payload.durationMs,
          startedAt: new Date(payload.startedAt),
        })
        .onConflictDoNothing();
    });
  }

  async applications(auth: TenantAuthContext, range: ResolvedRange): Promise<ApplicationsReport> {
    const rows = await this.database.forTenant(auth, (tx) =>
      this.statistics(tx, auth.organizationId, range, 'application_id'),
    );
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      applications: rows.map((row) => ({ applicationId: row.key!, ...toStats(row) })),
    };
  }

  async application(
    auth: TenantAuthContext,
    applicationId: string,
    range: ResolvedRange,
  ): Promise<ApplicationReport> {
    const { summary, endpoints } = await this.database.forTenant(auth, async (tx) => ({
      summary: await this.statistics(tx, auth.organizationId, range, null, applicationId),
      endpoints: await this.statistics(
        tx,
        auth.organizationId,
        range,
        'endpoint_id',
        applicationId,
      ),
    }));
    return {
      applicationId,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      summary: toStats(summary[0]),
      endpoints: endpoints.map((row) => ({ endpointId: row.key!, ...toStats(row) })),
    };
  }

  /** The organization is filtered here as well as by Row Level Security: two independent fences. */
  private async statistics(
    tx: AnalyticsTransaction,
    organizationId: string,
    range: ResolvedRange,
    groupBy: GroupBy,
    applicationId?: string,
  ): Promise<StatsRow[]> {
    const key = groupBy ? sql.raw(groupBy) : sql`null::uuid`;
    const grouping = groupBy
      ? sql`group by ${sql.raw(groupBy)} order by ${sql.raw(groupBy)}`
      : sql``;
    const application = applicationId ? sql`and application_id = ${applicationId}` : sql``;
    const result = await tx.execute<StatsRow>(sql`
      select ${key} as key,
             count(*)::int as attempts,
             (count(*) filter (where result = 'succeeded'))::int as successful,
             count(distinct delivery_id)::int as deliveries,
             round((percentile_cont(0.50) within group (order by duration_ms))::numeric, 2)::float8 as p50,
             round((percentile_cont(0.95) within group (order by duration_ms))::numeric, 2)::float8 as p95,
             round((percentile_cont(0.99) within group (order by duration_ms))::numeric, 2)::float8 as p99
        from delivery_attempts
       where organization_id = ${organizationId}
         and started_at >= ${range.from.toISOString()} and started_at < ${range.to.toISOString()}
         ${application}
       ${grouping}`);
    return result.rows;
  }
}
