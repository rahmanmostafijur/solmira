import { describe, expect, it } from 'vitest';
import { fieldMessages } from '../../test/support/field-messages.js';
import { assertValidPlacement } from './category-rules.js';

describe('category placement rules', () => {
  it('allows roots, children and grandchildren', () => {
    expect(() => assertValidPlacement({ parentChain: [], subtreeHeight: 0 })).not.toThrow();
    expect(() => assertValidPlacement({ parentChain: ['root'], subtreeHeight: 0 })).not.toThrow();
    expect(() =>
      assertValidPlacement({ parentChain: ['child', 'root'], subtreeHeight: 0 }),
    ).not.toThrow();
  });

  it('rejects a fourth level', () => {
    expect(
      fieldMessages(() =>
        assertValidPlacement({ parentChain: ['grandchild', 'child', 'root'], subtreeHeight: 0 }),
      ),
    ).toMatch(/at most 3/);
  });

  it('counts the height of the subtree being moved', () => {
    expect(
      fieldMessages(() =>
        assertValidPlacement({ categoryId: 'c', parentChain: ['child', 'root'], subtreeHeight: 1 }),
      ),
    ).toMatch(/at most 3/);
  });

  it('rejects cycles', () => {
    expect(
      fieldMessages(() =>
        assertValidPlacement({
          categoryId: 'root',
          parentChain: ['child', 'root'],
          subtreeHeight: 0,
        }),
      ),
    ).toMatch(/itself/);
    expect(
      fieldMessages(() =>
        assertValidPlacement({ categoryId: 'a', parentChain: ['a'], subtreeHeight: 0 }),
      ),
    ).toMatch(/itself/);
  });
});
