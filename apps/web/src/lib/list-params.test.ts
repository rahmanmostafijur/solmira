import { paginationQuerySchema, sortDirectionSchema } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseListParams, toApiQuery, toSearchString } from './list-params';

const listQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  sort: z.enum(['name', 'createdAt']).default('createdAt'),
  direction: sortDirectionSchema.default('desc'),
  code: z
    .string()
    .transform((value) => value.toUpperCase())
    .optional(),
});

describe('list params', () => {
  it('reads valid URL state with the API schema', () => {
    const params = parseListParams(
      listQuerySchema,
      new URLSearchParams('page=3&status=ACTIVE&sort=name&direction=asc&code=abc-1'),
    );
    expect(params).toMatchObject({
      page: 3,
      pageSize: 25,
      status: 'ACTIVE',
      sort: 'name',
      code: 'ABC-1',
    });
  });

  it('falls back to defaults when the URL was tampered with', () => {
    const params = parseListParams(
      listQuerySchema,
      new URLSearchParams('pageSize=5000&sort=password'),
    );
    expect(params).toEqual(listQuerySchema.parse({}));
  });

  it('writes only non-default values to the URL', () => {
    const defaults = listQuerySchema.parse({});
    expect(toSearchString({ ...defaults, status: 'ACTIVE', page: 1 }, defaults)).toBe(
      '?status=ACTIVE',
    );
    expect(toSearchString(defaults, defaults)).toBe('');
  });

  it('builds API query strings in a stable order without empty values', () => {
    expect(toApiQuery({ search: 'knife', page: 2, brand: '', status: undefined })).toBe(
      'page=2&search=knife',
    );
  });
});
