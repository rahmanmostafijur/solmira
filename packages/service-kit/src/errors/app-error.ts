import type { ErrorCode, FieldIssue } from '@solmira/contracts';

/**
 * Base class for errors that are safe to show to API clients. Anything that is not an
 * AppError (or a Nest HttpException) is treated as an internal error and masked.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: readonly FieldIssue[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: readonly FieldIssue[], message = 'Request validation failed') {
    super('VALIDATION_FAILED', message, 400, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class TokenExpiredError extends AppError {
  constructor() {
    super('TOKEN_EXPIRED', 'Access token has expired', 401);
  }
}

/** One message for unknown email and wrong password, so responses cannot enumerate accounts. */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS', 'Email or password is incorrect', 401);
  }
}

export class AccountDisabledError extends AppError {
  constructor() {
    super('ACCOUNT_DISABLED', 'This account has been disabled', 403);
  }
}

export class RateLimitedError extends AppError {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Too many attempts, try again later',
  ) {
    super('RATE_LIMITED', message, 429);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'The service is temporarily unavailable') {
    super('SERVICE_UNAVAILABLE', message, 503);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}
