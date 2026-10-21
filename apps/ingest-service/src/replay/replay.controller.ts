import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  replayEndpointRequestSchema,
  replayMessageRequestSchema,
  type ReplayEndpointRequest,
  type ReplayMessageRequest,
  type ReplayResult,
} from '@solmira/contracts';
import {
  ApiZodBody,
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { ReplayService } from './replay.service.js';

@ApiTags('replay')
@ApiBearerAuth()
@Controller('applications/:applicationId')
export class ReplayController {
  constructor(@Inject(ReplayService) private readonly replay: ReplayService) {}

  @Post('messages/:messageId/replay')
  @RequirePermission('deliveries.replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message again to its endpoints (a new retry cycle)' })
  @ApiZodBody(replayMessageRequestSchema)
  replayMessage(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('messageId', uuidParam) messageId: string,
    @Body(new ZodValidationPipe(replayMessageRequestSchema)) body: ReplayMessageRequest,
  ): Promise<ReplayResult> {
    return this.replay.replayMessage(auth, applicationId, messageId, body.endpointId);
  }

  @Post('endpoints/:endpointId/replay')
  @RequirePermission('deliveries.replay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replay the failed deliveries of an endpoint within a time range' })
  @ApiZodBody(replayEndpointRequestSchema)
  replayEndpoint(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
    @Body(new ZodValidationPipe(replayEndpointRequestSchema)) body: ReplayEndpointRequest,
  ): Promise<ReplayResult> {
    return this.replay.replayEndpoint(auth, applicationId, endpointId, body);
  }
}
