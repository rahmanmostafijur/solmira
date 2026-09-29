import { Inject, Injectable } from '@nestjs/common';
import { ValidationError, type TenantAuthContext } from '@solmira/service-kit';
import type { OperationsTransaction } from '../database/database.module.js';
import { memberDirectory } from '../database/schema.js';
import { MEMBER_LOOKUP } from '../operations.tokens.js';
import type { MemberLookup, OrganizationMember } from './member-lookup.js';

/**
 * Resolves a member for assignment (warehouse manager) and records it in the local directory in
 * the caller's transaction. Two layers enforce "same organization":
 *   1. identity-service answers 404 for a member of another organization (application layer);
 *   2. the composite foreign key (organization_id, manager_member_id) (database layer).
 */
@Injectable()
export class MemberDirectoryService {
  constructor(@Inject(MEMBER_LOOKUP) private readonly lookup: MemberLookup) {}

  async resolveForAssignment(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    memberId: string,
    bearerToken: string,
    field: string,
  ): Promise<OrganizationMember> {
    const member = await this.lookup.find(auth.organizationId, memberId, bearerToken);
    if (!member)
      throw new ValidationError([
        { path: field, message: 'Member not found in this organization' },
      ]);
    if (member.status !== 'active') {
      throw new ValidationError([{ path: field, message: 'Suspended members cannot be assigned' }]);
    }
    const row = {
      organizationId: auth.organizationId,
      memberId: member.memberId,
      userId: member.userId,
      fullName: member.fullName,
      email: member.email,
      status: member.status,
      syncedAt: new Date(),
    };
    await tx
      .insert(memberDirectory)
      .values(row)
      .onConflictDoUpdate({
        target: [memberDirectory.organizationId, memberDirectory.memberId],
        set: {
          userId: row.userId,
          fullName: row.fullName,
          email: row.email,
          status: row.status,
          syncedAt: row.syncedAt,
        },
      });
    return member;
  }
}
