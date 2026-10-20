import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applicationListQuerySchema,
  createApplicationRequestSchema,
  updateApplicationRequestSchema,
  type Application,
  type ApplicationListQuery,
  type CreateApplicationRequest,
  type UpdateApplicationRequest,
} from '@solmira/contracts';
import {
  ApiZodBody,
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { ApplicationsService } from './applications.service.js';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly applications: ApplicationsService) {}

  @Post()
  @RequirePermission('applications.create')
  @ApiOperation({ summary: 'Create an application (an app or environment such as production)' })
  @ApiZodBody(createApplicationRequestSchema)
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createApplicationRequestSchema)) body: CreateApplicationRequest,
  ): Promise<Application> {
    return this.applications.create(auth, body);
  }

  @Get()
  @RequirePermission('applications.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(applicationListQuerySchema)) query: ApplicationListQuery,
  ) {
    return this.applications.list(auth, query);
  }

  @Get(':applicationId')
  @RequirePermission('applications.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
  ): Promise<Application> {
    return this.applications.get(auth, applicationId);
  }

  @Patch(':applicationId')
  @RequirePermission('applications.update')
  @ApiZodBody(updateApplicationRequestSchema)
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Body(new ZodValidationPipe(updateApplicationRequestSchema)) body: UpdateApplicationRequest,
  ): Promise<Application> {
    return this.applications.update(auth, applicationId, body);
  }

  @Post(':applicationId/archive')
  @RequirePermission('applications.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive an application; it stops accepting messages' })
  archive(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
  ): Promise<Application> {
    return this.applications.archive(auth, applicationId);
  }

  @Post(':applicationId/restore')
  @RequirePermission('applications.delete')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
  ): Promise<Application> {
    return this.applications.restore(auth, applicationId);
  }
}
