import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { SessionSummary } from '@solmira/contracts';
import {
  CurrentAuth,
  NotFoundError,
  ZodValidationPipe,
  type AuthContext,
} from '@solmira/service-kit';
import { z } from 'zod';
import { SessionsService } from './sessions.service.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/sessions')
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<SessionSummary[]> {
    return this.sessions.listActive(auth.userId, auth.sessionId);
  }

  /** Signs out one device. Only the caller's own sessions are reachable; others are "not found". */
  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('sessionId', new ZodValidationPipe(z.uuid())) sessionId: string,
  ): Promise<void> {
    if (!(await this.sessions.revokeOwn(auth.userId, sessionId)))
      throw new NotFoundError('Session not found');
  }
}
