import { Inject, Injectable } from '@nestjs/common';
import type { Permission, RoleKey } from '@solmira/contracts';
import { and, asc, eq } from 'drizzle-orm';
import { Database } from '../database/database.module.js';
import { organizationMembers, organizations, rolePermissions, roles } from '../database/schema.js';

export interface OrganizationAccess {
  readonly organization: { readonly id: string; readonly name: string; readonly slug: string };
  readonly role: RoleKey;
  readonly permissions: readonly Permission[];
}

/**
 * Resolves what a user may do in an organization, from the database. This is what goes into an
 * access token, so a token is only ever issued for an active membership in an active organization.
 */
@Injectable()
export class AccessContextService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async resolve(userId: string, organizationId: string): Promise<OrganizationAccess | null> {
    return this.database.scoped({ organizationId, userId }, async (tx) => {
      const [membership] = await tx
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          organizationStatus: organizations.status,
          memberStatus: organizationMembers.status,
          roleId: roles.id,
          roleKey: roles.key,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (
        !membership ||
        membership.memberStatus !== 'active' ||
        membership.organizationStatus !== 'active'
      ) {
        return null;
      }
      const granted = await tx
        .select({ key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, membership.roleId));

      return {
        organization: { id: membership.id, name: membership.name, slug: membership.slug },
        role: membership.roleKey as RoleKey,
        permissions: granted.map((row) => row.key as Permission).sort(),
      };
    });
  }

  /** The organization a fresh login lands in: the user's oldest active membership. */
  async defaultOrganizationId(userId: string): Promise<string | null> {
    return this.database.scoped({ organizationId: null, userId }, async (tx) => {
      const [row] = await tx
        .select({ id: organizationMembers.organizationId })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.status, 'active'),
            eq(organizations.status, 'active'),
          ),
        )
        .orderBy(asc(organizationMembers.createdAt))
        .limit(1);
      return row?.id ?? null;
    });
  }
}
