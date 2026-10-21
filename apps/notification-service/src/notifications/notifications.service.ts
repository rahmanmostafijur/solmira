import { Inject, Injectable } from '@nestjs/common';
import type { EventEnvelope, ReadAllNotificationsResult } from '@solmira/contracts';
import { NotFoundError, offsetOf, pageOf, type TenantAuthContext } from '@solmira/service-kit';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Database } from '../database/database.module.js';
import { notifications, processedEvents } from '../database/schema.js';

export const ENDPOINT_ALERTS_CONSUMER = 'notification.endpoint-alerts';

export interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data: unknown;
  readonly createdAt: string;
  readonly readAt: string | null;
}

type Row = typeof notifications.$inferSelect;

const toView = (row: Row): NotificationView => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  data: row.data,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
});

interface AutoDisabledPayload {
  endpointId: string;
  applicationId: string;
  host: string;
  failingSince: string;
  consecutiveFailures: number;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /**
   * Turns an `endpoint.auto_disabled` event into one in-app notification. The event id is claimed
   * in the same transaction (and is unique on the notification), so a redelivered event adds
   * nothing: the tenant is told exactly once.
   */
  async onEndpointAutoDisabled(event: EventEnvelope): Promise<void> {
    const organizationId = event.organizationId;
    if (!organizationId) throw new Error('endpoint.auto_disabled without an organization');
    const payload = event.payload as AutoDisabledPayload;
    await this.database.forTenant({ organizationId, userId: null }, async (tx) => {
      const claimed = await tx
        .insert(processedEvents)
        .values({ consumer: ENDPOINT_ALERTS_CONSUMER, eventId: event.eventId })
        .onConflictDoNothing()
        .returning({ id: processedEvents.eventId });
      if (claimed.length === 0) return;
      const since = payload.failingSince.slice(0, 10);
      await tx
        .insert(notifications)
        .values({
          id: uuidv7(),
          organizationId,
          sourceEventId: event.eventId,
          type: 'endpoint.auto_disabled',
          title: 'Endpoint disabled after repeated failures',
          body:
            'Deliveries to ' +
            payload.host +
            ' have failed continuously since ' +
            since +
            ', so the endpoint was disabled. Fix the receiver, enable the endpoint and replay the failed messages.',
          data: { endpointId: payload.endpointId, applicationId: payload.applicationId },
        })
        .onConflictDoNothing();
    });
  }

  list(auth: TenantAuthContext, query: { page: number; pageSize: number; unreadOnly: boolean }) {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(notifications.organizationId, auth.organizationId),
        query.unreadOnly ? isNull(notifications.readAt) : undefined,
      );
      const [{ total = 0 } = {}] = await tx
        .select({ total: count() })
        .from(notifications)
        .where(where);
      const rows = await tx
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      return pageOf(rows.map(toView), total, query);
    });
  }

  /** Idempotent: reading twice keeps the first read time. */
  markRead(auth: TenantAuthContext, id: string): Promise<NotificationView> {
    return this.database.forTenant(auth, async (tx) => {
      const [current] = await tx
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.organizationId, auth.organizationId), eq(notifications.id, id)),
        );
      if (!current) throw new NotFoundError('Notification not found');
      if (current.readAt) return toView(current);
      const [row] = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(eq(notifications.organizationId, auth.organizationId), eq(notifications.id, id)))
        .returning();
      return toView(row!);
    });
  }

  /** Idempotent: notifications read before keep their first read time and are not counted. */
  markAllRead(auth: TenantAuthContext): Promise<ReadAllNotificationsResult> {
    return this.database.forTenant(auth, async (tx) => {
      const rows = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(eq(notifications.organizationId, auth.organizationId), isNull(notifications.readAt)),
        )
        .returning({ id: notifications.id });
      return { updated: rows.length };
    });
  }
}
