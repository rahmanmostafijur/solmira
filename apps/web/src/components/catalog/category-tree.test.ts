import type { Category } from '@solmira/contracts';
import { describe, expect, it } from 'vitest';
import { buildCategoryTree, categoryOptions, flattenTree, parentOptions } from './category-tree';

const category = (
  id: string,
  parentId: string | null,
  status: Category['status'] = 'ACTIVE',
): Category => ({
  id,
  name: id,
  slug: id,
  parentId,
  description: null,
  sortOrder: 0,
  status,
  productCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
});

// root > child > leaf, root > sibling, other (root), archived (root)
const categories = [
  category('root', null),
  category('child', 'root'),
  category('leaf', 'child'),
  category('sibling', 'root'),
  category('other', null),
  category('archived', null, 'ARCHIVED'),
];

describe('category tree', () => {
  it('nests categories with depths, in list order', () => {
    const flat = flattenTree(buildCategoryTree(categories)).map(
      (node) => `${node.depth}:${node.category.id}`,
    );
    expect(flat).toEqual(['1:root', '2:child', '3:leaf', '2:sibling', '1:other', '1:archived']);
  });

  it('shows categories whose parent is missing as roots', () => {
    const roots = buildCategoryTree([category('orphan', 'gone')]).map((node) => node.category.id);
    expect(roots).toEqual(['orphan']);
  });

  it('offers only parents that keep the tree within three levels', () => {
    expect(parentOptions(buildCategoryTree(categories)).map((o) => o.id)).toEqual([
      'root',
      'child',
      'sibling',
      'other',
    ]);
  });

  it('never offers a category, its descendants, or a parent too deep for its subtree', () => {
    const tree = buildCategoryTree(categories);
    // Moving "child" (height 2) needs a root parent, and not itself or "leaf".
    expect(parentOptions(tree, 'child').map((o) => o.id)).toEqual(['root', 'other']);
    // "root" already spans three levels, so it cannot go under anything.
    expect(parentOptions(tree, 'root')).toEqual([]);
    // "leaf" has no children and may sit under any category at depth 1 or 2.
    expect(parentOptions(tree, 'leaf').map((o) => o.id)).toEqual([
      'root',
      'child',
      'sibling',
      'other',
    ]);
  });

  it('indents option labels by depth', () => {
    expect(categoryOptions(categories, { activeOnly: true }).map((o) => o.label)).toEqual([
      'root',
      '— child',
      '— — leaf',
      '— sibling',
      'other',
    ]);
  });
});
