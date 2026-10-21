import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

function rejection(run: () => unknown): ValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error('expected a validation error');
}

describe('ZodValidationPipe', () => {
  const schema = z.object({ name: z.string().min(1).max(5), pageSize: z.coerce.number().max(10) });

  it('returns the parsed value and strips undeclared keys', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ name: 'a', pageSize: '3', role: 'OWNER' })).toEqual({
      name: 'a',
      pageSize: 3,
    });
  });

  it('answers 400 VALIDATION_FAILED with a summary and the field details of a body', () => {
    const error = rejection(() =>
      new ZodValidationPipe(schema).transform({ name: 'toolong', pageSize: 1 }, { type: 'body' }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('name is too long');
    expect(error.details).toEqual([
      {
        path: 'name',
        rule: 'too_long',
        message: 'name must be 1 to 5 characters long; got 7.',
        minimum: 1,
        maximum: 5,
      },
    ]);
  });

  it('names query parameters as such', () => {
    const error = rejection(() =>
      new ZodValidationPipe(schema).transform({ name: 'a', pageSize: '50' }, { type: 'query' }),
    );
    expect(error.message).toBe('Query parameter pageSize is too large');
    expect(error.details[0]?.message).toBe('Query parameter pageSize must be at most 10; got 50.');
  });

  it('names a path parameter after the route segment', () => {
    const error = rejection(() =>
      new ZodValidationPipe(z.uuid()).transform('nope', { type: 'param', data: 'applicationId' }),
    );
    expect(error.details[0]).toMatchObject({ path: 'applicationId', rule: 'invalid_format' });
    expect(error.message).toBe('Path parameter applicationId has an invalid format');
  });
});
