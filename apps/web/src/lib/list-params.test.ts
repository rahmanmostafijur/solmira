import { productListQuerySchema, supplierListQuerySchema } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { parseListParams, toApiQuery, toSearchString } from './list-params';

describe('list params', () => {
  it('reads valid URL state with the API schema', () => {
    const params = parseListParams(
      productListQuerySchema,
      new URLSearchParams('page=3&status=ACTIVE&sort=name&direction=asc&sku=abc-1'),
    );
    expect(params).toMatchObject({
      page: 3,
      pageSize: 25,
      status: 'ACTIVE',
      sort: 'name',
      sku: 'ABC-1',
    });
  });

  it('falls back to defaults when the URL was tampered with', () => {
    const params = parseListParams(
      productListQuerySchema,
      new URLSearchParams('pageSize=5000&sort=password'),
    );
    expect(params).toEqual(productListQuerySchema.parse({}));
  });

  it('writes only non-default values to the URL', () => {
    const defaults = supplierListQuerySchema.parse({});
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
