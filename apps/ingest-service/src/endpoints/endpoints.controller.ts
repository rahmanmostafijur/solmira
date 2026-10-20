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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEndpointRequestSchema,
  endpointListQuerySchema,
  updateEndpointRequestSchema,
  type CreateEndpointRequest,
  type CreatedEndpoint,
  type Endpoint,
  type EndpointListQuery,
  type RevealedSecret,
  type UpdateEndpointRequest,
} from '@solmira/contracts';
import {
  ApiZodBody,
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { EndpointSecretsService } from './endpoint-secrets.service.js';
import { EndpointsService } from './endpoints.service.js';

@ApiTags('endpoints')
@ApiBearerAuth()
@Controller('applications/:applicationId/endpoints')
export class EndpointsController {
  constructor(
    @Inject(EndpointsService) private readonly endpoints: EndpointsService,
    @Inject(EndpointSecretsService) private readonly secrets: EndpointSecretsService,
  ) {}

  @Post()
  @RequirePermission('endpoints.create')
  @ApiOperation({ summary: 'Create an endpoint; the response carries its signing secret once' })
  @ApiZodBody(createEndpointRequestSchema)
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Body(new ZodValidationPipe(createEndpointRequestSchema)) body: CreateEndpointRequest,
  ): Promise<CreatedEndpoint> {
    return this.endpoints.create(auth, applicationId, body);
  }

  @Get()
  @RequirePermission('endpoints.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Query(new ZodValidationPipe(endpointListQuerySchema)) query: EndpointListQuery,
  ) {
    return this.endpoints.list(auth, applicationId, query);
  }

  @Get(':endpointId')
  @RequirePermission('endpoints.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
  ): Promise<Endpoint> {
    return this.endpoints.get(auth, applicationId, endpointId);
  }

  @Patch(':endpointId')
  @RequirePermission('endpoints.update')
  @ApiZodBody(updateEndpointRequestSchema)
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
    @Body(new ZodValidationPipe(updateEndpointRequestSchema)) body: UpdateEndpointRequest,
  ): Promise<Endpoint> {
    return this.endpoints.update(auth, applicationId, endpointId, body);
  }

  @Delete(':endpointId')
  @RequirePermission('endpoints.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive an endpoint (idempotent); its history is kept' })
  archive(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
  ): Promise<void> {
    return this.endpoints.archive(auth, applicationId, endpointId);
  }

  @Post(':endpointId/secret/reveal')
  @RequirePermission('endpoint_secrets.reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reveal the signing secret; every call is audited' })
  reveal(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
  ): Promise<RevealedSecret> {
    return this.secrets.reveal(auth, applicationId, endpointId);
  }
}
