import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
  type CreateInvitationRequest,
  type CreateOrganizationRequest,
  type Invitation,
  type Member,
  type MembershipSummary,
  type Organization,
  type UpdateMemberRequest,
  type UpdateOrganizationRequest,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequireOrganization,
  RequirePermission,
  ZodValidationPipe,
  type AuthContext,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { z } from 'zod';
import { ApiZodBody } from '../openapi.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import { OrganizationsService } from './organizations.service.js';

const uuidParam = new ZodValidationPipe(z.uuid());

/**
 * Routes under /organizations/:organizationId only ever act on the organization in the caller's
 * token: the guard answers 404 when the path names any other organization, and the services
 * read the tenant from the auth context, never from the path.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(InvitationsService) private readonly invitations: InvitationsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization; the caller becomes its owner' })
  @ApiZodBody(createOrganizationRequestSchema)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createOrganizationRequestSchema)) body: CreateOrganizationRequest,
  ): Promise<Organization> {
    return this.organizations.create(auth, body);
  }

  @Get()
  @ApiOperation({ summary: 'Organizations the caller belongs to' })
  list(@CurrentAuth() auth: AuthContext): Promise<MembershipSummary[]> {
    return this.organizations.listForUser(auth.userId);
  }

  @Get(':organizationId')
  @RequirePermission('organizations.read')
  get(@CurrentAuth() auth: TenantAuthContext): Promise<Organization> {
    return this.organizations.get(auth);
  }

  @Patch(':organizationId')
  @RequirePermission('organizations.update')
  @ApiZodBody(updateOrganizationRequestSchema)
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(updateOrganizationRequestSchema)) body: UpdateOrganizationRequest,
  ): Promise<Organization> {
    return this.organizations.update(auth, body);
  }

  @Get(':organizationId/members')
  @RequirePermission('users.read')
  listMembers(@CurrentAuth() auth: TenantAuthContext): Promise<Member[]> {
    return this.members.list(auth);
  }

  /** Role changes need roles.assign, status changes users.update; checked per field. */
  @Patch(':organizationId/members/:memberId')
  @RequireOrganization()
  @ApiZodBody(updateMemberRequestSchema)
  updateMember(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('memberId', uuidParam) memberId: string,
    @Body(new ZodValidationPipe(updateMemberRequestSchema)) body: UpdateMemberRequest,
  ): Promise<Member> {
    return this.members.update(auth, memberId, body);
  }

  @Delete(':organizationId/members/:memberId')
  @RequirePermission('users.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('memberId', uuidParam) memberId: string,
  ): Promise<void> {
    return this.members.remove(auth, memberId);
  }

  @Get(':organizationId/invitations')
  @RequirePermission('users.read')
  listInvitations(@CurrentAuth() auth: TenantAuthContext): Promise<Invitation[]> {
    return this.invitations.listPending(auth);
  }

  @Post(':organizationId/invitations')
  @RequirePermission('users.create')
  @ApiZodBody(createInvitationRequestSchema)
  invite(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createInvitationRequestSchema)) body: CreateInvitationRequest,
  ): Promise<Invitation> {
    return this.invitations.create(auth, body);
  }

  @Delete(':organizationId/invitations/:invitationId')
  @RequirePermission('users.create')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('invitationId', uuidParam) invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(auth, invitationId);
  }
}
