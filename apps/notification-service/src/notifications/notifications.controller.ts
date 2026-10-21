import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationQuerySchema } from '@solmira/contracts';
import {
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { z } from 'zod';
import { NotificationsService, type NotificationView } from './notifications.service.js';

const listQuerySchema = paginationQuerySchema.extend({ unreadOnly: z.stringbool().default(false) });

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission('notifications.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.notifications.list(auth, query);
  }

  @Post(':notificationId/read')
  @RequirePermission('notifications.read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('notificationId', uuidParam) notificationId: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(auth, notificationId);
  }
}
