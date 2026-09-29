import { HttpException } from '@nestjs/common';
import type { ApiError, ErrorCode, FieldIssue } from '@solmira/contracts';
import { AppError } from './app-error.js';

export interface ErrorResponse {
  readonly status: number;
  readonly body: ApiError;
}

export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred';

const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Messages for body-parser failures, which reach the filter as plain errors with a `type`. */
const BODY_PARSER_MESSAGES: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'Request body is not valid JSON',
  'entity.too.large': 'Request body is too large',
  'encoding.unsupported': 'Unsupported content encoding',
  'charset.unsupported': 'Unsupported charset',
};

/**
 * Maps any thrown value to the public error envelope. Only AppError, HttpException and known
 * body-parser errors keep their message; everything else becomes a generic 500 so stack traces,
 * SQL and driver messages never reach clients.
 */
export function toErrorResponse(exception: unknown, requestId?: string): ErrorResponse {
  if (exception instanceof AppError) {
    return build(exception.status, exception.code, exception.message, requestId, exception.details);
  }
  if (exception instanceof HttpException) {
    return fromHttpException(exception, requestId);
  }
  const bodyParserError = asBodyParserError(exception);
  if (bodyParserError) {
    return build(
      bodyParserError.status,
      CODE_BY_STATUS[bodyParserError.status] ?? 'BAD_REQUEST',
      BODY_PARSER_MESSAGES[bodyParserError.type] ?? 'Malformed request',
      requestId,
    );
  }
  return build(500, 'INTERNAL_ERROR', INTERNAL_ERROR_MESSAGE, requestId);
}

function fromHttpException(exception: HttpException, requestId?: string): ErrorResponse {
  const status = exception.getStatus();
  if (status >= 500) {
    const code = status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
    return build(status, code, INTERNAL_ERROR_MESSAGE, requestId);
  }
  return build(
    status,
    CODE_BY_STATUS[status] ?? 'BAD_REQUEST',
    httpExceptionMessage(exception),
    requestId,
  );
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const { message } = response as { message: unknown };
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
  }
  return exception.message;
}

function asBodyParserError(exception: unknown): { status: number; type: string } | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, type, expose } = exception as {
    status?: unknown;
    type?: unknown;
    expose?: unknown;
  };
  const isClientError = typeof status === 'number' && status >= 400 && status < 500;
  return isClientError && typeof type === 'string' && expose === true
    ? { status, type }
    : undefined;
}

function build(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string | undefined,
  details?: readonly FieldIssue[],
): ErrorResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
        ...(details && details.length > 0 ? { details: [...details] } : {}),
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
