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
  createEventTypeRequestSchema,
  eventTypeListQuerySchema,
  updateEventTypeRequestSchema,
  type CreateEventTypeRequest,
  type EventType,
  type EventTypeListQuery,
  type UpdateEventTypeRequest,
} from '@solmira/contracts';
import {
  ApiZodBody,
  CurrentAuth,
  RequirePermission,
  ZodValidationPipe,
  uuidParam,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { EventTypesService } from './event-types.service.js';

@ApiTags('event-types')
@ApiBearerAuth()
@Controller('event-types')
export class EventTypesController {
  constructor(@Inject(EventTypesService) private readonly eventTypes: EventTypesService) {}

  @Post()
  @RequirePermission('event_types.create')
  @ApiZodBody(createEventTypeRequestSchema)
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body(new ZodValidationPipe(createEventTypeRequestSchema)) body: CreateEventTypeRequest,
  ): Promise<EventType> {
    return this.eventTypes.create(auth, body);
  }

  @Get()
  @RequirePermission('event_types.read')
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query(new ZodValidationPipe(eventTypeListQuerySchema)) query: EventTypeListQuery,
  ) {
    return this.eventTypes.list(auth, query);
  }

  @Get(':eventTypeId')
  @RequirePermission('event_types.read')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('eventTypeId', uuidParam) eventTypeId: string,
  ): Promise<EventType> {
    return this.eventTypes.get(auth, eventTypeId);
  }

  @Patch(':eventTypeId')
  @RequirePermission('event_types.update')
  @ApiZodBody(updateEventTypeRequestSchema)
  update(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('eventTypeId', uuidParam) eventTypeId: string,
    @Body(new ZodValidationPipe(updateEventTypeRequestSchema)) body: UpdateEventTypeRequest,
  ): Promise<EventType> {
    return this.eventTypes.update(auth, eventTypeId, body);
  }

  @Post(':eventTypeId/archive')
  @RequirePermission('event_types.delete')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('eventTypeId', uuidParam) eventTypeId: string,
  ): Promise<EventType> {
    return this.eventTypes.archive(auth, eventTypeId);
  }

  @Post(':eventTypeId/restore')
  @RequirePermission('event_types.delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived event type (idempotent)' })
  restore(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('eventTypeId', uuidParam) eventTypeId: string,
  ): Promise<EventType> {
    return this.eventTypes.restore(auth, eventTypeId);
  }
}
