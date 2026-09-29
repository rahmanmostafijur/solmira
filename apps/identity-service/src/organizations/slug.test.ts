import { SLUG_PATTERN } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { slugify, withRandomSuffix } from './slug.js';

describe('slugify', () => {
  it.each([
    ['Northwind Traders', 'northwind-traders'],
    ['Nordic Pâtisserie & Co.', 'nordic-patisserie-co'],
    ['  --Harbor   Supply--  ', 'harbor-supply'],
    ['株式会社', 'organization'],
  ])('turns %j into %j', (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it('always produces slugs the API accepts, including with a suffix', () => {
    for (const name of ['A', 'x'.repeat(200), 'Acme 2026', 'Ünïcödé Ltd']) {
      expect(slugify(name)).toMatch(SLUG_PATTERN);
      expect(withRandomSuffix(slugify(name))).toMatch(SLUG_PATTERN);
    }
  });
});
