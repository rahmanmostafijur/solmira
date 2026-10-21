import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  IDEMPOTENCY_KEY_EXAMPLE,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  createMessageRequestSchema,
  idempotencyKeySchema,
  type CreateMessageRequest,
  type Message,
} from '@solmira/contracts';
import {
  ApiZodBody,
  Public,
  ZodValidationPipe,
  parseRequestPart,
  uuidParam,
} from '@solmira/service-kit';
import type { Response } from 'express';
import type { ApiKeyPrincipal } from '../api-keys/api-key-authenticator.js';
import { ApiKeyGuard, CurrentApiKey, RequireApiKeyScope } from './api-key-auth.js';
import { MessagesService } from './messages.service.js';

/** Nest pipes do not run on single headers, so the key is validated here; errors name the header. */
function idempotencyKeyOf(value: string | undefined): string {
  return parseRequestPart(idempotencyKeySchema, value, { part: 'header', name: 'Idempotency-Key' });
}

/** The ingestion API. Authenticated by API key, not by a console token. */
@ApiTags('messages')
@ApiSecurity('api-key')
@Controller('applications/:applicationId/messages')
@Public()
@UseGuards(ApiKeyGuard)
export class MessagesController {
  constructor(@Inject(MessagesService) private readonly messages: MessagesService) {}

  /** 202 for a new message, 200 when the Idempotency-Key replays one that already exists. */
  @Post()
  @RequireApiKeyScope('messages:write')
  @ApiOperation({ summary: 'Send an event; it is delivered to every subscribed endpoint' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: `${IDEMPOTENCY_KEY_MIN_LENGTH} to ${IDEMPOTENCY_KEY_MAX_LENGTH} letters, digits or - _ : . unique to this message`,
    example: IDEMPOTENCY_KEY_EXAMPLE,
  })
  @ApiZodBody(createMessageRequestSchema)
  async create(
    @CurrentApiKey() principal: ApiKeyPrincipal,
    @Param('applicationId', uuidParam) applicationId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Body(new ZodValidationPipe(createMessageRequestSchema)) body: CreateMessageRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Message> {
    const result = await this.messages.ingest(
      principal,
      applicationId,
      idempotencyKeyOf(key),
      body,
    );
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result.message;
  }
}
