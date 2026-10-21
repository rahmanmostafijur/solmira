import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  deliveryListQuerySchema,
  messageListQuerySchema,
  type DeliveryListQuery,
  type MessageDetail,
  type MessageListQuery,
} from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { InspectionService } from './inspection.service.js';

@ApiTags('inspection')
@ApiBearerAuth()
@Controller('applications/:applicationId')
export class InspectionController {
  constructor(@Inject(InspectionService) private readonly inspection: InspectionService) {}

  @Get('messages')
  @RequirePermission('messages.read')
  listMessages(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Query(new ZodValidationPipe(messageListQuerySchema)) query: MessageListQuery,
  ) {
    return this.inspection.listMessages(auth, applicationId, query);
  }

  @Get('messages/:messageId')
  @RequirePermission('messages.read')
  getMessage(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('messageId', uuidParam) messageId: string,
  ): Promise<MessageDetail> {
    return this.inspection.getMessage(auth, applicationId, messageId);
  }

  @Get('endpoints/:endpointId/deliveries')
  @RequirePermission('messages.read')
  listDeliveries(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('applicationId', uuidParam) applicationId: string,
    @Param('endpointId', uuidParam) endpointId: string,
    @Query(new ZodValidationPipe(deliveryListQuerySchema)) query: DeliveryListQuery,
  ) {
    return this.inspection.listEndpointDeliveries(auth, applicationId, endpointId, query);
  }
}
