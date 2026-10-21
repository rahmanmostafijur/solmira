import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateEventTypeRequest,
  EventType,
  EventTypeListQuery,
  UpdateEventTypeRequest,
} from '@solmira/contracts';
import {
  NotFoundError,
  offsetOf,
  pageOf,
  rethrowConflict,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Database, type IngestTransaction } from '../database/database.module.js';
import { eventTypes } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { assertCompilableSchema } from './payload-schema.js';

type EventTypeRow = typeof eventTypes.$inferSelect;

const NAME_CONFLICT = { event_types_org_name_key: 'An event type with this name already exists' };

export function toEventType(row: EventTypeRow): EventType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schema: (row.schema as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function findEventType(
  tx: IngestTransaction,
  auth: TenantAuthContext,
  id: string,
): Promise<EventTypeRow> {
  const [row] = await tx
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.organizationId, auth.organizationId), eq(eventTypes.id, id)));
  if (!row) throw new NotFoundError('Event type not found');
  return row;
}

@Injectable()
export class EventTypesService {
  constructor(@Inject(Database) private readonly database: Database) {}

  list(auth: TenantAuthContext, query: EventTypeListQuery) {
    return this.database.forTenant(auth, async (tx) => {
      const filter: SQL | undefined = query.includeArchived
        ? undefined
        : isNull(eventTypes.archivedAt);
      const where = and(eq(eventTypes.organizationId, auth.organizationId), filter);
      const [{ total = 0 } = {}] = await tx
        .select({ total: count() })
        .from(eventTypes)
        .where(where);
      const rows = await tx
        .select()
        .from(eventTypes)
        .where(where)
        .orderBy(desc(eventTypes.createdAt), desc(eventTypes.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      return pageOf(rows.map(toEventType), total, query);
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<EventType> {
    return this.database.forTenant(auth, async (tx) =>
      toEventType(await findEventType(tx, auth, id)),
    );
  }

  async create(auth: TenantAuthContext, input: CreateEventTypeRequest): Promise<EventType> {
    if (input.schema) assertCompilableSchema(input.schema);
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const [row] = await tx
          .insert(eventTypes)
          .values({
            id: uuidv7(),
            organizationId: auth.organizationId,
            name: input.name,
            description: input.description ?? null,
            schema: input.schema ?? null,
          })
          .returning();
        await recordEvent(tx, auth, 'event_type.created', {
          eventTypeId: row!.id,
          name: row!.name,
        });
        return toEventType(row!);
      });
    } catch (error) {
      return rethrowConflict(error, NAME_CONFLICT);
    }
  }

  update(auth: TenantAuthContext, id: string, input: UpdateEventTypeRequest): Promise<EventType> {
    if (input.schema) assertCompilableSchema(input.schema);
    return this.database.forTenant(auth, async (tx) => {
      await findEventType(tx, auth, id);
      const [row] = await tx
        .update(eventTypes)
        .set({
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.schema !== undefined ? { schema: input.schema } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(eventTypes.organizationId, auth.organizationId), eq(eventTypes.id, id)))
        .returning();
      await recordEvent(tx, auth, 'event_type.updated', {
        eventTypeId: id,
        fields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
      });
      return toEventType(row!);
    });
  }

  /** Idempotent. An archived event type accepts no new messages and cannot be subscribed to. */
  archive(auth: TenantAuthContext, id: string): Promise<EventType> {
    return this.setArchived(auth, id, true);
  }

  /**
   * Idempotent: restoring a live event type changes nothing and records nothing. The name stays
   * reserved while archived, so a restore cannot collide with another event type.
   */
  restore(auth: TenantAuthContext, id: string): Promise<EventType> {
    return this.setArchived(auth, id, false);
  }

  private setArchived(auth: TenantAuthContext, id: string, archived: boolean): Promise<EventType> {
    return this.database.forTenant(auth, async (tx) => {
      const current = await findEventType(tx, auth, id);
      if ((current.archivedAt !== null) === archived) return toEventType(current);
      const [row] = await tx
        .update(eventTypes)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(eventTypes.organizationId, auth.organizationId), eq(eventTypes.id, id)))
        .returning();
      await recordEvent(tx, auth, archived ? 'event_type.archived' : 'event_type.restored', {
        eventTypeId: id,
      });
      return toEventType(row!);
    });
  }
}
