import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateWarehouseRequest,
  Page,
  UpdateWarehouseRequest,
  Warehouse,
  WarehouseListQuery,
} from '@solmira/contracts';
import type { TenantAuthContext } from '@solmira/service-kit';
import { and, asc, count, desc, eq, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { contains, iso, offsetOf, orNotFound, pageOf, rethrowConflict } from '../common/query.js';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { memberDirectory, warehouses } from '../database/schema.js';
import { MemberDirectoryService } from '../members/member-directory.service.js';
import { recordEvent } from '../outbox/outbox.js';

type WarehouseRow = typeof warehouses.$inferSelect;
type ManagerRow = { memberId: string; fullName: string; email: string } | null;

const CONFLICTS = { warehouses_org_code_key: 'Another warehouse already uses this code' };

const SORT_COLUMNS = {
  code: warehouses.code,
  name: warehouses.name,
  createdAt: warehouses.createdAt,
} as const;

const managerColumns = {
  memberId: memberDirectory.memberId,
  fullName: memberDirectory.fullName,
  email: memberDirectory.email,
};

function toWarehouse(row: WarehouseRow, manager: ManagerRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    addressLine: row.addressLine,
    city: row.city,
    country: row.country,
    manager: manager?.memberId ? manager : null,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

@Injectable()
export class WarehousesService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(MemberDirectoryService) private readonly members: MemberDirectoryService,
  ) {}

  async list(auth: TenantAuthContext, query: WarehouseListQuery): Promise<Page<Warehouse>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(warehouses.organizationId, auth.organizationId),
        query.status ? eq(warehouses.status, query.status) : undefined,
        query.search
          ? or(
              contains(warehouses.code, query.search),
              contains(warehouses.name, query.search),
              contains(warehouses.city, query.search),
            )
          : undefined,
      );
      const sortColumn = SORT_COLUMNS[query.sort];
      // One query: the manager's display name comes from the local directory, not a call per row.
      const rows = await tx
        .select({ warehouse: warehouses, manager: managerColumns })
        .from(warehouses)
        .leftJoin(
          memberDirectory,
          and(
            eq(memberDirectory.organizationId, warehouses.organizationId),
            eq(memberDirectory.memberId, warehouses.managerMemberId),
          ),
        )
        .where(where)
        .orderBy(query.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(warehouses.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await tx.select({ n: count() }).from(warehouses).where(where);
      return pageOf(
        rows.map((row) => toWarehouse(row.warehouse, row.manager)),
        total?.n ?? 0,
        query,
      );
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<Warehouse> {
    return this.database.forTenant(auth, (tx) => this.load(tx, auth, id));
  }

  async create(
    auth: TenantAuthContext,
    input: CreateWarehouseRequest,
    bearerToken: string,
  ): Promise<Warehouse> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        if (input.managerMemberId) {
          await this.members.resolveForAssignment(
            tx,
            auth,
            input.managerMemberId,
            bearerToken,
            'managerMemberId',
          );
        }
        const [row] = await tx
          .insert(warehouses)
          .values({ id: uuidv7(), organizationId: auth.organizationId, ...input })
          .returning();
        await recordEvent(tx, auth, 'warehouse.created', { warehouseId: row!.id, code: row!.code });
        return this.load(tx, auth, row!.id);
      });
    } catch (error) {
      rethrowConflict(error, CONFLICTS);
    }
  }

  async update(
    auth: TenantAuthContext,
    id: string,
    input: UpdateWarehouseRequest,
    bearerToken: string,
  ): Promise<Warehouse> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const [current] = await tx
          .select({ status: warehouses.status, managerMemberId: warehouses.managerMemberId })
          .from(warehouses)
          .where(and(eq(warehouses.organizationId, auth.organizationId), eq(warehouses.id, id)))
          .for('update');
        orNotFound(current, 'Warehouse');
        if (input.managerMemberId && input.managerMemberId !== current!.managerMemberId) {
          await this.members.resolveForAssignment(
            tx,
            auth,
            input.managerMemberId,
            bearerToken,
            'managerMemberId',
          );
        }
        await tx
          .update(warehouses)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(warehouses.organizationId, auth.organizationId), eq(warehouses.id, id)));
        if (input.status && input.status !== current!.status) {
          await recordEvent(tx, auth, 'warehouse.status_changed', {
            warehouseId: id,
            fromStatus: current!.status,
            toStatus: input.status,
          });
        }
        const fields = Object.keys(input).filter((field) => field !== 'status');
        if (fields.length > 0)
          await recordEvent(tx, auth, 'warehouse.updated', { warehouseId: id, fields });
        return this.load(tx, auth, id);
      });
    } catch (error) {
      rethrowConflict(error, CONFLICTS);
    }
  }

  /** Warehouses will hold stock (phase 4), so they are deactivated, never deleted. Idempotent. */
  async deactivate(auth: TenantAuthContext, id: string, bearerToken: string): Promise<void> {
    await this.update(auth, id, { status: 'INACTIVE' }, bearerToken);
  }

  private async load(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<Warehouse> {
    const [row] = await tx
      .select({ warehouse: warehouses, manager: managerColumns })
      .from(warehouses)
      .leftJoin(
        memberDirectory,
        and(
          eq(memberDirectory.organizationId, warehouses.organizationId),
          eq(memberDirectory.memberId, warehouses.managerMemberId),
        ),
      )
      .where(and(eq(warehouses.organizationId, auth.organizationId), eq(warehouses.id, id)));
    const found = orNotFound(row, 'Warehouse');
    return toWarehouse(found.warehouse, found.manager);
  }
}
