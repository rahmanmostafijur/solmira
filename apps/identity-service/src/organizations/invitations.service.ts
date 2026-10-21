import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assignableRoles,
  type CreateInvitationRequest,
  type Invitation,
  type RoleKey,
} from '@solmira/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AuthContext,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { InvalidLinkError } from '../auth/account-recovery.service.js';
import { generateOpaqueToken, hashToken } from '../auth/secrets.js';
import type { IdentityConfig } from '../config.js';
import { Database } from '../database/database.module.js';
import { isUniqueViolation } from '../database/errors.js';
import {
  invitations,
  organizationMembers,
  organizations,
  roles,
  users,
} from '../database/schema.js';
import { EMAIL_SENDER, IDENTITY_CONFIG } from '../identity.tokens.js';
import type { EmailSender } from '../mail/email-sender.js';
import { recordEvent } from '../outbox/outbox.js';
import { systemRoleId } from './organizations.service.js';

const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000;

type InvitationLookup = {
  id: string;
  organization_id: string;
  email: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
};

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async create(auth: TenantAuthContext, input: CreateInvitationRequest): Promise<Invitation> {
    if (!assignableRoles(auth.role).includes(input.role)) {
      throw new ForbiddenError('You cannot invite people with this role');
    }
    const token = generateOpaqueToken();
    const { invitation, organizationName } = await this.database.scoped(
      this.scope(auth),
      async (tx) => {
        const [existing] = await tx
          .select({ id: organizationMembers.id })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .where(
            and(
              eq(organizationMembers.organizationId, auth.organizationId),
              eq(users.email, input.email),
            ),
          );
        if (existing) throw new ConflictError('This person is already a member');

        const [organization] = await tx
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, auth.organizationId));
        const id = uuidv7();
        let row: typeof invitations.$inferSelect | undefined;
        try {
          [row] = await tx
            .insert(invitations)
            .values({
              id,
              organizationId: auth.organizationId,
              email: input.email,
              roleId: await systemRoleId(tx, input.role),
              tokenHash: hashToken(token),
              invitedByUserId: auth.userId,
              expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
            })
            .returning();
        } catch (error) {
          if (isUniqueViolation(error, 'invitations_open_email_key')) {
            throw new ConflictError('An invitation is already pending for this email');
          }
          throw error;
        }
        await recordEvent(
          tx,
          'member.invited',
          { invitationId: id, email: input.email, role: input.role },
          { organizationId: auth.organizationId, actorId: auth.userId },
        );
        return {
          invitation: {
            id,
            email: input.email,
            role: input.role,
            expiresAt: row!.expiresAt.toISOString(),
            createdAt: row!.createdAt.toISOString(),
          },
          organizationName: organization?.name ?? 'an organization',
        };
      },
    );

    await this.send(input.email, organizationName, token);
    return invitation;
  }

  async listPending(auth: TenantAuthContext): Promise<Invitation[]> {
    return this.database.scoped(this.scope(auth), async (tx) => {
      const rows = await tx
        .select({
          id: invitations.id,
          email: invitations.email,
          role: roles.key,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .innerJoin(roles, eq(roles.id, invitations.roleId))
        .where(
          and(
            eq(invitations.organizationId, auth.organizationId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(invitations.createdAt));
      return rows.map((row) => ({
        ...row,
        role: row.role as RoleKey,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  async revoke(auth: TenantAuthContext, invitationId: string): Promise<void> {
    const revoked = await this.database.scoped(this.scope(auth), async (tx) => {
      const rows = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.organizationId, auth.organizationId),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .returning({ id: invitations.id });
      // Recorded with the change, so the audit trail shows who withdrew an invitation.
      if (rows.length > 0) {
        await recordEvent(
          tx,
          'invitation.revoked',
          { invitationId },
          { organizationId: auth.organizationId, actorId: auth.userId },
        );
      }
      return rows;
    });
    if (revoked.length === 0) throw new NotFoundError('Invitation not found');
  }

  /**
   * The token proves the invitation was received; the signed-in account must also own the
   * invited email, so a forwarded or leaked link cannot be redeemed by someone else.
   */
  async accept(auth: AuthContext, token: string): Promise<{ organizationId: string }> {
    const lookup = await this.database.unscoped(async (tx) => {
      const result = await tx.execute<InvitationLookup>(
        sql`select id, organization_id, email, expires_at, accepted_at, revoked_at
              from find_invitation_by_token_hash(${hashToken(token)})`,
      );
      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, auth.userId));
      return { invitation: result.rows[0], userEmail: user?.email };
    });
    const invitation = lookup.invitation;
    if (
      !invitation ||
      invitation.accepted_at ||
      invitation.revoked_at ||
      new Date(invitation.expires_at) <= new Date()
    ) {
      throw new InvalidLinkError();
    }
    if (invitation.email.toLowerCase() !== lookup.userEmail?.toLowerCase()) {
      throw new ForbiddenError('This invitation was sent to a different email address');
    }

    const organizationId = invitation.organization_id;
    await this.database.scoped({ organizationId, userId: auth.userId }, async (tx) => {
      // Re-read and lock inside the invitation's tenant context: two concurrent accepts of the
      // same link serialise here, and only the first one finds the invitation still open.
      const [open] = await tx
        .select({ id: invitations.id, roleId: invitations.roleId, role: roles.key })
        .from(invitations)
        .innerJoin(roles, eq(roles.id, invitations.roleId))
        .where(
          and(
            eq(invitations.id, invitation.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
          ),
        )
        .for('update', { of: invitations });
      if (!open) throw new InvalidLinkError();

      const [alreadyMember] = await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, auth.userId),
          ),
        );
      if (!alreadyMember) {
        const memberId = uuidv7();
        await tx.insert(organizationMembers).values({
          id: memberId,
          organizationId,
          userId: auth.userId,
          roleId: open.roleId,
        });
        await recordEvent(
          tx,
          'member.joined',
          { memberId, userId: auth.userId, role: open.role },
          { organizationId, actorId: auth.userId },
        );
      }
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, open.id));
    });
    return { organizationId };
  }

  private async send(to: string, organizationName: string, token: string): Promise<void> {
    const link = `${this.config.APP_URL}/accept-invitation?token=${encodeURIComponent(token)}`;
    try {
      await this.email.send({
        to,
        subject: `You have been invited to ${organizationName} on Solmira`,
        text: `You have been invited to join ${organizationName} on Solmira.\n\n${link}\n\nThe invitation expires in 7 days.`,
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to send invitation email');
    }
  }

  private scope(auth: TenantAuthContext) {
    return { organizationId: auth.organizationId, userId: auth.userId };
  }
}
