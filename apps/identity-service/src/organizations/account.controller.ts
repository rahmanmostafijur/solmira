import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSION_CATALOG,
  tokenRequestSchema,
  type MeResponse,
  type Permission,
  type RoleKey,
  type RoleSummary,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  UnauthenticatedError,
  ZodValidationPipe,
  type AuthContext,
  ApiZodBody,
} from '@solmira/service-kit';
import { asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { Database } from '../database/database.module.js';
import { rolePermissions, roles, users } from '../database/schema.js';
import { InvitationsService } from './invitations.service.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('account')
@ApiBearerAuth()
@Controller()
export class AccountController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    const [user] = await this.database.unscoped((tx) =>
      tx.select().from(users).where(eq(users.id, auth.userId)),
    );
    if (!user) throw new UnauthenticatedError();
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerified: user.emailVerifiedAt !== null,
      },
      memberships: await this.organizations.listForUser(auth.userId),
      activeOrganizationId: auth.organizationId,
    };
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(tokenRequestSchema)
  acceptInvitation(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(tokenRequestSchema)) body: z.infer<typeof tokenRequestSchema>,
  ): Promise<{ organizationId: string }> {
    return this.invitations.accept(auth, body.token);
  }

  @Get('roles')
  @RequirePermission('roles.read')
  async roles(@CurrentAuth() auth: AuthContext): Promise<RoleSummary[]> {
    return this.database.scoped(
      { organizationId: auth.organizationId, userId: auth.userId },
      async (tx) => {
        const rows = await tx
          .select({
            key: roles.key,
            name: roles.name,
            description: roles.description,
            rank: roles.rank,
            permission: rolePermissions.permissionKey,
          })
          .from(roles)
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .where(isNull(roles.organizationId))
          .orderBy(asc(roles.rank));
        const byKey = new Map<string, RoleSummary>();
        for (const row of rows) {
          const role =
            byKey.get(row.key) ??
            ({
              key: row.key as RoleKey,
              name: row.name,
              description: row.description,
              rank: row.rank,
              permissions: [],
            } as RoleSummary);
          if (row.permission) role.permissions.push(row.permission as Permission);
          byKey.set(row.key, role);
        }
        return [...byKey.values()].sort((a, b) => b.rank - a.rank);
      },
    );
  }

  @Get('permissions')
  permissions(): { key: Permission; description: string }[] {
    return Object.entries(PERMISSION_CATALOG).map(([key, description]) => ({
      key: key as Permission,
      description,
    }));
  }
}
