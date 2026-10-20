import { Inject, Injectable } from '@nestjs/common';
import type {
  Application,
  ApplicationListQuery,
  CreateApplicationRequest,
  UpdateApplicationRequest,
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
import { applications } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';

type ApplicationRow = typeof applications.$inferSelect;

const NAME_CONFLICT = {
  applications_org_name_live_idx: 'An application with this name already exists',
};

export function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** The application of this organization, or 404. Archived ones are found only when asked for. */
export async function findApplication(
  tx: IngestTransaction,
  auth: TenantAuthContext,
  id: string,
  options: { includeArchived: boolean } = { includeArchived: false },
): Promise<ApplicationRow> {
  const conditions = [
    eq(applications.organizationId, auth.organizationId),
    eq(applications.id, id),
  ];
  if (!options.includeArchived) conditions.push(isNull(applications.archivedAt));
  const [row] = await tx
    .select()
    .from(applications)
    .where(and(...conditions));
  if (!row) throw new NotFoundError('Application not found');
  return row;
}

@Injectable()
export class ApplicationsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  list(auth: TenantAuthContext, query: ApplicationListQuery) {
    return this.database.forTenant(auth, async (tx) => {
      const filter: SQL | undefined = query.includeArchived
        ? undefined
        : isNull(applications.archivedAt);
      const where = and(eq(applications.organizationId, auth.organizationId), filter);
      const [{ total = 0 } = {}] = await tx
        .select({ total: count() })
        .from(applications)
        .where(where);
      const rows = await tx
        .select()
        .from(applications)
        .where(where)
        .orderBy(desc(applications.createdAt), desc(applications.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      return pageOf(rows.map(toApplication), total, query);
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<Application> {
    return this.database.forTenant(auth, async (tx) =>
      toApplication(await findApplication(tx, auth, id, { includeArchived: true })),
    );
  }

  async create(auth: TenantAuthContext, input: CreateApplicationRequest): Promise<Application> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const [row] = await tx
          .insert(applications)
          .values({
            id: uuidv7(),
            organizationId: auth.organizationId,
            name: input.name,
            description: input.description ?? null,
          })
          .returning();
        await recordEvent(tx, auth, 'application.created', {
          applicationId: row!.id,
          name: row!.name,
        });
        return toApplication(row!);
      });
    } catch (error) {
      return rethrowConflict(error, NAME_CONFLICT);
    }
  }

  async update(
    auth: TenantAuthContext,
    id: string,
    input: UpdateApplicationRequest,
  ): Promise<Application> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        await findApplication(tx, auth, id);
        const [row] = await tx
          .update(applications)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(applications.organizationId, auth.organizationId), eq(applications.id, id)))
          .returning();
        await recordEvent(tx, auth, 'application.updated', {
          applicationId: id,
          fields: Object.keys(input).filter(
            (key) => input[key as keyof typeof input] !== undefined,
          ),
        });
        return toApplication(row!);
      });
    } catch (error) {
      return rethrowConflict(error, NAME_CONFLICT);
    }
  }

  /** Idempotent: archiving an archived application changes nothing and records nothing. */
  archive(auth: TenantAuthContext, id: string): Promise<Application> {
    return this.setArchived(auth, id, true);
  }

  async restore(auth: TenantAuthContext, id: string): Promise<Application> {
    try {
      return await this.setArchived(auth, id, false);
    } catch (error) {
      // Restoring can collide with a live application that took the name meanwhile.
      return rethrowConflict(error, NAME_CONFLICT);
    }
  }

  private setArchived(
    auth: TenantAuthContext,
    id: string,
    archived: boolean,
  ): Promise<Application> {
    return this.database.forTenant(auth, async (tx) => {
      const current = await findApplication(tx, auth, id, { includeArchived: true });
      if ((current.archivedAt !== null) === archived) return toApplication(current);
      const [row] = await tx
        .update(applications)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(applications.organizationId, auth.organizationId), eq(applications.id, id)))
        .returning();
      await recordEvent(tx, auth, archived ? 'application.archived' : 'application.restored', {
        applicationId: id,
      });
      return toApplication(row!);
    });
  }
}
