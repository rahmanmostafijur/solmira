import { idempotencyKeySchema, paginationQuerySchema } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';
import { parseRequestPart, type ValidationTarget } from './field-issues.js';

const body: ValidationTarget = { part: 'body' };

function failure(schema: z.ZodType, value: unknown, target: ValidationTarget = body) {
  try {
    parseRequestPart(schema, value, target);
  } catch (error) {
    if (error instanceof ValidationError) return { message: error.message, details: error.details };
    throw error;
  }
  throw new Error('expected a validation error');
}

const firstIssue = (schema: z.ZodType, value: unknown, target?: ValidationTarget) =>
  failure(schema, value, target).details[0];

describe('parseRequestPart', () => {
  it('returns the parsed value when it is valid', () => {
    expect(parseRequestPart(z.object({ a: z.string().trim() }), { a: ' x ' }, body)).toEqual({
      a: 'x',
    });
  });

  it('reports a missing field as required, with an example when the schema declares one', () => {
    const schema = z.object({ eventType: z.string().meta({ examples: ['invoice.paid'] }) });
    expect(firstIssue(schema, {})).toEqual({
      path: 'eventType',
      rule: 'required',
      message: 'eventType is required. Example: invoice.paid',
      example: 'invoice.paid',
    });
  });

  it('reports a wrong type and what was sent instead', () => {
    const issue = firstIssue(z.object({ payload: z.record(z.string(), z.unknown()) }), {
      payload: 'text',
    });
    expect(issue).toMatchObject({ path: 'payload', rule: 'invalid_type' });
    expect(issue?.message).toBe('payload must be a JSON object; got a string.');
  });

  it('reports a fraction where a whole number is expected', () => {
    const issue = firstIssue(z.object({ limit: z.number().int() }), { limit: 1.5 });
    expect(issue?.message).toBe('limit must be a whole number; got 1.5.');
  });

  it('reports text that is too short or too long with both limits and the length sent', () => {
    const schema = z.object({ name: z.string().min(2).max(10) });
    expect(firstIssue(schema, { name: 'a' })).toEqual({
      path: 'name',
      rule: 'too_short',
      message: 'name must be 2 to 10 characters long; got 1.',
      minimum: 2,
      maximum: 10,
    });
    expect(firstIssue(schema, { name: 'x'.repeat(11) })).toMatchObject({
      rule: 'too_long',
      message: 'name must be 2 to 10 characters long; got 11.',
      minimum: 2,
      maximum: 10,
    });
    expect(firstIssue(z.object({ name: z.string().min(1) }), { name: '' })?.message).toBe(
      'name must not be empty.',
    );
  });

  it('reports numbers and lists outside their range as too small or too big', () => {
    const number = z.object({ rate: z.number().min(1).max(1000) });
    expect(firstIssue(number, { rate: 0 })).toMatchObject({
      rule: 'too_small',
      message: 'rate must be between 1 and 1000; got 0.',
      minimum: 1,
      maximum: 1000,
    });
    expect(firstIssue(number, { rate: 1001 })).toMatchObject({ rule: 'too_big', maximum: 1000 });
    const list = z.object({ ids: z.array(z.string()).max(2) });
    expect(firstIssue(list, { ids: ['a', 'b', 'c'] })).toMatchObject({
      rule: 'too_big',
      message: 'ids can have at most 2 items; got 3.',
      maximum: 2,
    });
  });

  it('reports a malformed value with the expected format and an example', () => {
    expect(firstIssue(z.object({ id: z.uuid() }), { id: 'x' })).toEqual({
      path: 'id',
      rule: 'invalid_format',
      message: 'id must be a UUID. Example: 0190b0a0-7c5e-7000-8000-000000000009',
      example: '0190b0a0-7c5e-7000-8000-000000000009',
    });
    expect(firstIssue(z.object({ email: z.email() }), { email: 'nope' })?.message).toBe(
      'email must be a valid email address. Example: ana@example.com',
    );
  });

  it('reports a value outside an enum with the allowed values', () => {
    const issue = firstIssue(z.object({ status: z.enum(['pending', 'failed']) }), {
      status: 'done',
    });
    expect(issue).toMatchObject({ rule: 'invalid_enum', example: 'pending' });
    expect(issue?.message).toBe(
      'status must be one of "pending", "failed"; got "done". Example: pending',
    );
  });

  it('never repeats a long value back', () => {
    const issue = firstIssue(z.object({ status: z.enum(['a', 'b']) }), { status: 'x'.repeat(80) });
    expect(issue?.message).not.toContain('xxxx');
  });

  it('reports each unknown field of a strict object on its own path', () => {
    const { details } = failure(z.strictObject({ a: z.string() }), { a: 'x', b: 1, c: 2 });
    expect(details).toEqual([
      { path: 'b', rule: 'unrecognized_key', message: 'b is not a known field; remove it.' },
      { path: 'c', rule: 'unrecognized_key', message: 'c is not a known field; remove it.' },
    ]);
  });

  it('keeps messages the schema wrote and still classifies the rule', () => {
    const schema = z.object({
      slug: z.string().regex(/^[a-z]+$/, 'Use lowercase letters, for example acme'),
      to: z.string().refine((value) => value > 'b', 'The end must be after the start'),
    });
    const { details, message } = failure(schema, { slug: 'A', to: 'a' });
    expect(details[0]).toMatchObject({
      rule: 'invalid_format',
      message: 'Use lowercase letters, for example acme',
    });
    expect(details[1]).toMatchObject({
      rule: 'invalid',
      message: 'The end must be after the start',
    });
    expect(message).toBe('slug has an invalid format (and 1 more problem)');
  });

  it('summarizes the first problem in the top-level message', () => {
    expect(failure(z.object({ name: z.string().max(3) }), { name: 'long' }).message).toBe(
      'name is too long',
    );
    expect(
      failure(
        z.object({}).refine(() => false, 'Send something'),
        {},
      ).message,
    ).toBe('Send something');
  });

  it('names query and path parameters', () => {
    const query: ValidationTarget = { part: 'query' };
    const issue = firstIssue(paginationQuerySchema, { pageSize: '500' }, query);
    expect(issue).toMatchObject({ path: 'pageSize', rule: 'too_big', minimum: 1, maximum: 100 });
    expect(issue?.message).toBe('Query parameter pageSize must be between 1 and 100; got 500.');
    expect(failure(paginationQuerySchema, { page: 'x' }, query).message).toBe(
      'Query parameter page has the wrong type',
    );
    const param = firstIssue(z.uuid(), 'abc', { part: 'param', name: 'endpointId' });
    expect(param).toMatchObject({ path: 'endpointId', rule: 'invalid_format' });
    expect(param?.message).toMatch(/^Path parameter endpointId must be a UUID\./);
  });
});

describe('Idempotency-Key errors', () => {
  const header: ValidationTarget = { part: 'header', name: 'Idempotency-Key' };

  it('says how long the key must be, how long it was and what a good one looks like', () => {
    const { message, details } = failure(idempotencyKeySchema, 'short', header);
    expect(message).toBe('Idempotency-Key is too short');
    expect(details).toEqual([
      {
        path: 'Idempotency-Key',
        rule: 'too_short',
        message:
          'Idempotency-Key must be 8 to 100 characters long (letters, digits, - _ : .); got 5. ' +
          'Example: order-1234-created',
        example: 'order-1234-created',
        minimum: 8,
        maximum: 100,
      },
    ]);
  });

  it('reports a key that is too long or uses other characters', () => {
    expect(firstIssue(idempotencyKeySchema, 'k'.repeat(101), header)).toMatchObject({
      rule: 'too_long',
      maximum: 100,
    });
    const symbols = firstIssue(idempotencyKeySchema, 'has spaces here', header);
    expect(symbols).toMatchObject({ rule: 'invalid_format', example: 'order-1234-created' });
    expect(symbols?.message).toContain('letters, digits and - _ : .');
  });

  it('asks for the header when it is missing', () => {
    const { message, details } = failure(idempotencyKeySchema, undefined, header);
    expect(message).toBe('Idempotency-Key is required');
    expect(details[0]?.message).toMatch(/^Send an Idempotency-Key header/);
    expect(details[0]?.rule).toBe('required');
  });
});
