import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from './app-error.js';
import { INTERNAL_ERROR_MESSAGE, toErrorResponse } from './error-response.js';

describe('toErrorResponse', () => {
  it('maps AppError subclasses to their status, code and message', () => {
    const response = toErrorResponse(new ConflictError('SKU already exists'), 'req-1');

    expect(response).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'SKU already exists', requestId: 'req-1' } },
    });
  });

  it('includes field issues for validation errors', () => {
    const response = toErrorResponse(
      new ValidationError([{ path: 'email', message: 'Invalid email' }]),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details).toEqual([{ path: 'email', message: 'Invalid email' }]);
  });

  it('keeps client-facing messages of Nest 4xx exceptions', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /x')).body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Cannot GET /x',
    });
    expect(
      toErrorResponse(new BadRequestException(['a is required', 'b is required'])).body.error
        .message,
    ).toBe('a is required; b is required');
  });

  it('masks unknown errors as a generic 500', () => {
    const leaky = new Error('duplicate key value violates unique constraint "users_email_key"');

    const response = toErrorResponse(leaky, 'req-2');

    expect(response).toEqual({
      status: 500,
      body: {
        error: { code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, requestId: 'req-2' },
      },
    });
  });

  it('masks messages of Nest 5xx exceptions', () => {
    const response = toErrorResponse(new ServiceUnavailableException('redis at 10.0.3.7 refused'));

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: INTERNAL_ERROR_MESSAGE,
    });
  });

  it('maps body-parser errors without echoing parser internals', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token } in JSON at position 12'), {
      status: 400,
      type: 'entity.parse.failed',
      expose: true,
    });

    expect(toErrorResponse(parseError).body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Request body is not valid JSON',
    });
  });

  it('does not trust status fields on arbitrary objects', () => {
    expect(toErrorResponse({ status: 418, type: 'teapot' }).status).toBe(500);
    expect(toErrorResponse('boom').status).toBe(500);
    expect(toErrorResponse(null).status).toBe(500);
  });

  it('omits empty details', () => {
    expect(toErrorResponse(new NotFoundError()).body.error).not.toHaveProperty('details');
  });
});
