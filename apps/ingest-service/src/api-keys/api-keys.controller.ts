import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  apiKeyListQuerySchema,
  createApiKeyRequestSchema,
  type ApiKeyListQuery,
  type CreateApiKeyRequest,
  type CreatedApiKey,
} from '@solmira/contracts';
import {
  ApiZodBody,
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { ApiKeysService } from './api-keys.service.js';

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('applications/:applicationId/api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly apiKeys: ApiKeysService) {}

  @Post()
  @RequirePermission('api_keys.create')
  @ApiOperation({ summary: 'Create an API key; the response carries the key once' })
  @ApiZodBody(createApiKeyRequestSchema)
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Body(new ZodValidationPipe(createApiKeyRequestSchema)) body: CreateApiKeyRequest,
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(auth, applicationId, body);
  }

  @Get()
  @RequirePermission('api_keys.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Query(new ZodValidationPipe(apiKeyListQuerySchema)) query: ApiKeyListQuery,
  ) {
    return this.apiKeys.list(auth, applicationId, query);
  }

  @Delete(':apiKeyId')
  @RequirePermission('api_keys.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key (idempotent); it stops working immediately' })
  revoke(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('apiKeyId', uuidParam) apiKeyId: string,
  ): Promise<void> {
    return this.apiKeys.revoke(auth, applicationId, apiKeyId);
  }
}
