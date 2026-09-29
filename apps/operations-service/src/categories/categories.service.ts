import { Inject, Injectable } from '@nestjs/common';
import type {
  Category,
  CategoryListQuery,
  CreateCategoryRequest,
  Page,
  UpdateCategoryRequest,
} from '@solmira/contracts';
import { ConflictError, type TenantAuthContext } from '@solmira/service-kit';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  contains,
  iso,
  offsetOf,
  orNotFound,
  pageOf,
  referenceError,
  rethrowConflict,
} from '../common/query.js';
import { slugify } from '../common/slug.js';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { violatedConstraint } from '../database/errors.js';
import { categories, products } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { assertValidPlacement } from './category-rules.js';

type CategoryRow = typeof categories.$inferSelect;

const CONFLICTS = { categories_org_slug_key: 'Another category already uses this URL name' };

const productCount = sql<number>`(select count(*)::int from ${products} p
  where p.organization_id = ${categories.organizationId} and p.category_id = ${categories.id})`;

function toCategory(row: CategoryRow, products: number): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parentId,
    description: row.description,
    sortOrder: row.sortOrder,
    status: row.status,
    productCount: products,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

@Injectable()
export class CategoriesService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async list(auth: TenantAuthContext, query: CategoryListQuery): Promise<Page<Category>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(categories.organizationId, auth.organizationId),
        query.status ? eq(categories.status, query.status) : undefined,
        query.parentId ? eq(categories.parentId, query.parentId) : undefined,
        query.search ? contains(categories.name, query.search) : undefined,
      );
      const rows = await tx
        .select({ category: categories, productCount })
        .from(categories)
        .where(where)
        .orderBy(asc(categories.sortOrder), asc(categories.name), asc(categories.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await tx.select({ n: count() }).from(categories).where(where);
      return pageOf(
        rows.map((row) => toCategory(row.category, row.productCount)),
        total?.n ?? 0,
        query,
      );
    });
  }

  async get(auth: TenantAuthContext, id: string): Promise<Category> {
    return this.database.forTenant(auth, (tx) => this.load(tx, auth, id));
  }

  async create(auth: TenantAuthContext, input: CreateCategoryRequest): Promise<Category> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const parentChain = input.parentId ? await this.parentChain(tx, auth, input.parentId) : [];
        assertValidPlacement({ parentChain, subtreeHeight: 0 });
        const [row] = await tx
          .insert(categories)
          .values({
            id: uuidv7(),
            organizationId: auth.organizationId,
            parentId: input.parentId ?? null,
            name: input.name,
            slug: input.slug ?? slugify(input.name),
            description: input.description ?? null,
            sortOrder: input.sortOrder ?? 0,
          })
          .returning();
        await recordEvent(tx, auth, 'category.created', {
          categoryId: row!.id,
          name: row!.name,
          parentId: row!.parentId,
        });
        return toCategory(row!, 0);
      });
    } catch (error) {
      rethrowConflict(error, CONFLICTS);
    }
  }

  async update(
    auth: TenantAuthContext,
    id: string,
    input: UpdateCategoryRequest,
  ): Promise<Category> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        const [current] = await tx
          .select()
          .from(categories)
          .where(and(eq(categories.organizationId, auth.organizationId), eq(categories.id, id)))
          .for('update');
        orNotFound(current, 'Category');
        if (input.parentId !== undefined && input.parentId !== current!.parentId) {
          const parentChain = input.parentId
            ? await this.parentChain(tx, auth, input.parentId)
            : [];
          assertValidPlacement({
            categoryId: id,
            parentChain,
            subtreeHeight: await this.subtreeHeight(tx, auth, id),
          });
        }
        await tx
          .update(categories)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(categories.organizationId, auth.organizationId), eq(categories.id, id)));
        await recordEvent(tx, auth, 'category.updated', {
          categoryId: id,
          fields: Object.keys(input),
        });
        return this.load(tx, auth, id);
      });
    } catch (error) {
      rethrowConflict(error, CONFLICTS);
    }
  }

  /**
   * Categories are organizational labels, not history: an empty one is deleted outright. One
   * that still holds products or subcategories is protected by foreign keys (ON DELETE RESTRICT),
   * so the user is asked to move them or archive the category instead.
   */
  async delete(auth: TenantAuthContext, id: string): Promise<void> {
    try {
      await this.database.forTenant(auth, async (tx) => {
        const deleted = await tx
          .delete(categories)
          .where(and(eq(categories.organizationId, auth.organizationId), eq(categories.id, id)))
          .returning({ id: categories.id });
        orNotFound(deleted[0], 'Category');
        await recordEvent(tx, auth, 'category.deleted', { categoryId: id });
      });
    } catch (error) {
      if (violatedConstraint(error, 'foreign_key') !== undefined) {
        throw new ConflictError(
          'This category still has products or subcategories. Move them or archive the category.',
        );
      }
      throw error;
    }
  }

  private async load(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<Category> {
    const [row] = await tx
      .select({ category: categories, productCount })
      .from(categories)
      .where(and(eq(categories.organizationId, auth.organizationId), eq(categories.id, id)));
    const found = orNotFound(row, 'Category');
    return toCategory(found.category, found.productCount);
  }

  /** The parent and its ancestors, nearest first. A parent outside this tenant is invisible (RLS). */
  private async parentChain(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    parentId: string,
  ): Promise<string[]> {
    const [parent] = await tx
      .select({ id: categories.id, status: categories.status })
      .from(categories)
      .where(and(eq(categories.organizationId, auth.organizationId), eq(categories.id, parentId)));
    if (!parent || parent.status !== 'ACTIVE') throw referenceError('parentId', 'Parent category');
    const result = await tx.execute<{ id: string }>(sql`
      with recursive chain(id, parent_id, depth) as (
        select id, parent_id, 1 from ${categories} where id = ${parentId}
        union all
        select c.id, c.parent_id, chain.depth + 1 from ${categories} c join chain on c.id = chain.parent_id
        where chain.depth < 10
      )
      select id from chain order by depth`);
    return result.rows.map((row) => row.id);
  }

  private async subtreeHeight(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<number> {
    const result = await tx.execute<{ height: number }>(sql`
      with recursive tree(id, level) as (
        select id, 0 from ${categories} where id = ${id} and organization_id = ${auth.organizationId}
        union all
        select c.id, tree.level + 1 from ${categories} c join tree on c.parent_id = tree.id
        where tree.level < 10
      )
      select coalesce(max(level), 0)::int as height from tree`);
    return result.rows[0]?.height ?? 0;
  }
}
