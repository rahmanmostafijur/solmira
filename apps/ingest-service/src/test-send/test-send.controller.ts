import { Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TestSendResult } from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { TestSendService } from './test-send.service.js';

@ApiTags('endpoints')
@ApiBearerAuth()
@Controller('applications/:applicationId/endpoints/:endpointId')
export class TestSendController {
  constructor(@Inject(TestSendService) private readonly testSend: TestSendService) {}

  @Post('test')
  @RequirePermission('endpoints.update')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a test event to this endpoint only' })
  send(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
  ): Promise<TestSendResult> {
    return this.testSend.send(auth, applicationId, endpointId);
  }
}
