import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateSupplierRequest,
  Page,
  Supplier,
  SupplierListQuery,
  UpdateSupplierRequest,
} from '@solmira/contracts';
import type { TenantAuthContext } from '@solmira/service-kit';
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { contains, iso, offsetOf, orNotFound, pageOf, rethrowConflict } from '../common/query.js';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { products, suppliers } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';

type SupplierRow = typeof suppliers.$inferSelect;

const CONFLICTS = {
  suppliers_org_company_name_key: 'A supplier with this company name already exists',
};

const productCount = sql<number>`(select count(*)::int from ${products} p
  where p.organization_id = ${suppliers.organizationId} and p.supplier_id = ${suppliers.id})`;

const SORT_COLUMNS = {
  companyName: sql`lower(${suppliers.companyName})`,
  leadTimeDays: suppliers.leadTimeDays,
  createdAt: suppliers.createdAt,
  updatedAt: suppliers.updatedAt,
} as const;

function toSupplier(row: SupplierRow, productTotal: number): Supplier {
  return {
    id: row.id,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    addressLine: row.addressLine,
    city: row.city,
    country: row.country,
    paymentTerms: row.paymentTerms,
    leadTimeDays: row.leadTimeDays,
    status: row.status,
    notes: row.notes,
    productCount: productTotal,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

@Injectable()
export class SuppliersService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(auth: TenantAuthContext, query: SupplierListQuery): Promise<Page<Supplier>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(suppliers.organizationId, auth.organizationId),
        query.status ? eq(suppliers.status, query.status) : undefined,
        query.country ? eq(suppliers.country, query.country) : undefined,
        query.search
          ? or(
              contains(suppliers.companyName, query.search),
              contains(suppliers.contactName, query.search),
              contains(suppliers.email, query.search),
            )
          : undefined,
      );
      const sortColumn = SORT_COLUMNS[query.sort];
      const rows = await tx
        .select({ supplier: suppliers, productCount })
        .from(suppliers)
        .where(where)
        .orderBy(query.direction === 'asc' ? asc(sortColumn) : desc(sortColumn), asc(suppliers.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await tx.select({ n: count() }).from(suppliers).where(where);
      return pageOf(
        rows.map((row) => toSupplier(row.supplier, row.productCount)),
        total?.n ?? 0,
        query,
      );
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<Supplier> {
    return this.database.forTenant(auth, (tx) => this.load(tx, auth, id));
  }

  async create(auth: TenantAuthContext, input: CreateSupplierRequest): Promise<Supplier> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const [row] = await tx
          .insert(suppliers)
          .values({ id: uuidv7(), organizationId: auth.organizationId, ...input })
          .returning();
        await recordEvent(tx, auth, 'supplier.created', {
          supplierId: row!.id,
          companyName: row!.companyName,
        });
        return toSupplier(row!, 0);
      });
    } catch (error) {
      rethrowConflict(error, CONFLICTS);
    }
  }

  /** ACTIVE ⇄ INACTIVE is the whole lifecycle; restoring is setting status back to ACTIVE. */
  async update(
    auth: TenantAuthContext,
    id: string,
    input: UpdateSupplierRequest,
  ): Promise<Supplier> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const [current] = await tx
          .select({ status: suppliers.status })
          .from(suppliers)
          .where(and(eq(suppliers.organizationId, auth.organizationId), eq(suppliers.id, id)))
          .for('update');
        orNotFound(current, 'Supplier');
        await tx
          .update(suppliers)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(suppliers.organizationId, auth.organizationId), eq(suppliers.id, id)));
        if (input.status && input.status !== current!.status) {
          await recordEvent(tx, auth, 'supplier.status_changed', {
            supplierId: id,
            fromStatus: current!.status,
            toStatus: input.status,
          });
        }
        const fields = Object.keys(input).filter((field) => field !== 'status');
        if (fields.length > 0)
          await recordEvent(tx, auth, 'supplier.updated', { supplierId: id, fields });
        return this.load(tx, auth, id);
      });
    } catch (error) {
      rethrowConflict(error, CONFLICTS);
    }
  }

  /**
   * Suppliers are never hard-deleted: products and (later) purchase orders reference them.
   * "Delete" deactivates, which blocks new assignments but keeps history intact. Idempotent.
   */
  async deactivate(auth: TenantAuthContext, id: string): Promise<void> {
    await this.update(auth, id, { status: 'INACTIVE' });
  }

  private async load(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<Supplier> {
    const [row] = await tx
      .select({ supplier: suppliers, productCount })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, auth.organizationId), eq(suppliers.id, id)));
    const found = orNotFound(row, 'Supplier');
    return toSupplier(found.supplier, found.productCount);
  }
}
