import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { getRequestContext } from '../context/request-context.js';
import { RateLimitedError } from './app-error.js';
import { toErrorResponse } from './error-response.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception, getRequestContext()?.requestId);

    if (status >= 500) {
      // Full detail stays server-side; the client only sees the masked envelope.
      this.logger.error({ err: exception }, 'Request failed with an unhandled error');
    }
    if (response.headersSent) {
      return;
    }
    if (exception instanceof RateLimitedError) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    response.status(status).json(body);
  }
}
