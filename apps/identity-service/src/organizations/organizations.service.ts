import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateOrganizationRequest,
  MembershipSummary,
  Organization,
  RoleKey,
  UpdateOrganizationRequest,
} from '@solmira/contracts';
import {
  ConflictError,
  NotFoundError,
  type AuthContext,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { Database, type IdentityTransaction } from '../database/database.module.js';
import { isUniqueViolation } from '../database/errors.js';
import { organizationMembers, organizations, roles } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { slugify, withRandomSuffix } from './slug.js';

type OrganizationRow = typeof organizations.$inferSelect;

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    timezone: row.timezone,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function systemRoleId(tx: IdentityTransaction, key: RoleKey): Promise<string> {
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.key, key), isNull(roles.organizationId)));
  if (!role) throw new Error(`System role ${key} is missing; run migrations`);
  return role.id;
}

const SLUG_ATTEMPTS = 3;

@Injectable()
export class OrganizationsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** The creator becomes the first OWNER in the same transaction as the organization itself. */
  async create(auth: AuthContext, input: CreateOrganizationRequest): Promise<Organization> {
    const requestedSlug = input.slug;
    const baseSlug = requestedSlug ?? slugify(input.name);

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const slug = attempt === 0 ? baseSlug : withRandomSuffix(baseSlug);
      const organizationId = uuidv7();
      try {
        // The new id is the tenant context, so RLS admits exactly this INSERT and nothing else.
        return await this.database.scoped({ organizationId, userId: auth.userId }, async (tx) => {
          const [row] = await tx
            .insert(organizations)
            .values({ id: organizationId, name: input.name, slug })
            .returning();
          const memberId = uuidv7();
          await tx.insert(organizationMembers).values({
            id: memberId,
            organizationId,
            userId: auth.userId,
            roleId: await systemRoleId(tx, 'OWNER'),
          });
          const meta = { organizationId, actorId: auth.userId };
          await recordEvent(
            tx,
            'organization.created',
            { organizationId, name: input.name, ownerUserId: auth.userId },
            meta,
          );
          await recordEvent(
            tx,
            'member.joined',
            { memberId, userId: auth.userId, role: 'OWNER' },
            meta,
          );
          return toOrganization(row!);
        });
      } catch (error) {
        if (!isUniqueViolation(error, 'organizations_slug_unique')) throw error;
        if (requestedSlug) throw new ConflictError('This URL name is already taken');
      }
    }
    throw new ConflictError('Could not find a free URL name, choose one explicitly');
  }

  /** Organizations the caller belongs to, across tenants (RLS: the user's own memberships). */
  async listForUser(userId: string): Promise<MembershipSummary[]> {
    return this.database.scoped({ organizationId: null, userId }, async (tx) => {
      const rows = await tx
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          role: roles.key,
          status: organizationMembers.status,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
        .where(eq(organizationMembers.userId, userId))
        .orderBy(asc(organizations.name));
      return rows.map((row) => ({
        organization: { id: row.id, name: row.name, slug: row.slug },
        role: row.role as RoleKey,
        status: row.status,
      }));
    });
  }

  async get(auth: TenantAuthContext): Promise<Organization> {
    const [row] = await this.database.scoped(this.scope(auth), (tx) =>
      tx.select().from(organizations).where(eq(organizations.id, auth.organizationId)),
    );
    if (!row) throw new NotFoundError('Organization not found');
    return toOrganization(row);
  }

  async update(auth: TenantAuthContext, input: UpdateOrganizationRequest): Promise<Organization> {
    return this.database.scoped(this.scope(auth), async (tx) => {
      const [row] = await tx
        .update(organizations)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(organizations.id, auth.organizationId))
        .returning();
      if (!row) throw new NotFoundError('Organization not found');
      await recordEvent(
        tx,
        'organization.updated',
        { organizationId: row.id, fields: Object.keys(input) },
        { organizationId: row.id, actorId: auth.userId },
      );
      return toOrganization(row);
    });
  }

  private scope(auth: TenantAuthContext) {
    return { organizationId: auth.organizationId, userId: auth.userId };
  }
}
