import { Inject, Injectable } from '@nestjs/common';
import {
  assignableRoles,
  canManageMember,
  hasPermissions,
  type Member,
  type RoleKey,
  type UpdateMemberRequest,
} from '@solmira/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  REVOCATION_STORE,
  type RevocationStore,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { Database, type IdentityTransaction } from '../database/database.module.js';
import { organizationMembers, roles, users } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { systemRoleId } from './organizations.service.js';

interface TargetMember {
  readonly id: string;
  readonly userId: string;
  readonly role: RoleKey;
  readonly status: 'active' | 'suspended';
}

/**
 * Membership management. Every rule is enforced here, on the server, from the verified auth
 * context; the web app only mirrors the same rules to hide controls.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(REVOCATION_STORE) private readonly revocations: RevocationStore,
  ) {}

  async list(auth: TenantAuthContext): Promise<Member[]> {
    return this.database.scoped(this.scope(auth), async (tx) => {
      const rows = await tx
        .select({
          id: organizationMembers.id,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          role: roles.key,
          status: organizationMembers.status,
          createdAt: organizationMembers.createdAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
        .where(eq(organizationMembers.organizationId, auth.organizationId))
        .orderBy(asc(organizationMembers.createdAt));
      return rows.map((row) => ({
        ...row,
        role: row.role as RoleKey,
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  async update(
    auth: TenantAuthContext,
    memberId: string,
    change: UpdateMemberRequest,
  ): Promise<Member> {
    if (change.role !== undefined && !hasPermissions(auth.permissions, ['roles.assign']))
      throw new ForbiddenError();
    if (change.status !== undefined && !hasPermissions(auth.permissions, ['users.update']))
      throw new ForbiddenError();

    const target = await this.database.scoped(this.scope(auth), async (tx) => {
      const member = await this.lockTarget(tx, auth, memberId);
      if (change.role !== undefined && change.role !== member.role) {
        if (!assignableRoles(auth.role).includes(change.role)) {
          throw new ForbiddenError('You cannot grant this role');
        }
        if (member.role === 'OWNER') await this.assertAnotherActiveOwner(tx, auth, member.id);
        await tx
          .update(organizationMembers)
          .set({ roleId: await systemRoleId(tx, change.role), updatedAt: new Date() })
          .where(eq(organizationMembers.id, member.id));
        await recordEvent(
          tx,
          'member.role_changed',
          {
            memberId: member.id,
            userId: member.userId,
            fromRole: member.role,
            toRole: change.role,
          },
          this.eventMeta(auth),
        );
      }
      if (change.status !== undefined && change.status !== member.status) {
        if (member.role === 'OWNER' && change.status === 'suspended') {
          await this.assertAnotherActiveOwner(tx, auth, member.id);
        }
        await tx
          .update(organizationMembers)
          .set({ status: change.status, updatedAt: new Date() })
          .where(eq(organizationMembers.id, member.id));
        await recordEvent(
          tx,
          'member.status_changed',
          { memberId: member.id, userId: member.userId, status: change.status },
          this.eventMeta(auth),
        );
      }
      return member;
    });

    // Tokens the member already holds still carry the old role; invalidate them now.
    await this.revocations.revokeMembership(auth.organizationId, target.userId);
    const updated = (await this.list(auth)).find((member) => member.id === memberId);
    if (!updated) throw new NotFoundError('Member not found');
    return updated;
  }

  async remove(auth: TenantAuthContext, memberId: string): Promise<void> {
    const target = await this.database.scoped(this.scope(auth), async (tx) => {
      const member = await this.lockTarget(tx, auth, memberId);
      if (member.role === 'OWNER') await this.assertAnotherActiveOwner(tx, auth, member.id);
      await tx.delete(organizationMembers).where(eq(organizationMembers.id, member.id));
      await recordEvent(
        tx,
        'member.removed',
        { memberId: member.id, userId: member.userId },
        this.eventMeta(auth),
      );
      return member;
    });
    await this.revocations.revokeMembership(auth.organizationId, target.userId);
  }

  /**
   * Loads and locks the target inside the caller's organization. A member of another
   * organization is indistinguishable from a missing one (404), so ids cannot be probed.
   */
  private async lockTarget(
    tx: IdentityTransaction,
    auth: TenantAuthContext,
    memberId: string,
  ): Promise<TargetMember> {
    const [member] = await tx
      .select({
        id: organizationMembers.id,
        userId: organizationMembers.userId,
        role: roles.key,
        status: organizationMembers.status,
      })
      .from(organizationMembers)
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .where(
        and(
          eq(organizationMembers.id, memberId),
          eq(organizationMembers.organizationId, auth.organizationId),
        ),
      )
      .for('update', { of: organizationMembers });
    if (!member) throw new NotFoundError('Member not found');
    if (member.userId === auth.userId)
      throw new ForbiddenError('You cannot change your own membership');
    const target = { ...member, role: member.role as RoleKey };
    if (!canManageMember(auth.role, target.role))
      throw new ForbiddenError('You cannot manage this member');
    return target;
  }

  /**
   * Invariant: after demoting, suspending or removing an owner, at least one *other* active owner
   * remains. With self-changes forbidden the acting owner usually satisfies it; the check keeps
   * the invariant true regardless of how the rules around it evolve.
   */
  private async assertAnotherActiveOwner(
    tx: IdentityTransaction,
    auth: TenantAuthContext,
    targetMemberId: string,
  ): Promise<void> {
    const ownerRoleId = await systemRoleId(tx, 'OWNER');
    const [result] = await tx
      .select({ owners: count() })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, auth.organizationId),
          eq(organizationMembers.roleId, ownerRoleId),
          eq(organizationMembers.status, 'active'),
          ne(organizationMembers.id, targetMemberId),
        ),
      );
    if ((result?.owners ?? 0) < 1)
      throw new ConflictError('An organization needs at least one active owner');
  }

  private scope(auth: TenantAuthContext) {
    return { organizationId: auth.organizationId, userId: auth.userId };
  }

  private eventMeta(auth: TenantAuthContext) {
    return { organizationId: auth.organizationId, actorId: auth.userId };
  }
}
