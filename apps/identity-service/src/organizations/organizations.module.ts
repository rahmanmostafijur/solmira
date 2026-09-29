import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

@Module({
  controllers: [OrganizationsController, AccountController],
  providers: [OrganizationsService, MembersService, InvitationsService],
})
export class OrganizationsModule {}
