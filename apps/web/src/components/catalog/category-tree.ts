import { MAX_CATEGORY_DEPTH, type Category } from '@solmira/contracts';

export interface CategoryNode {
  readonly category: Category;
  readonly depth: number;
  readonly children: readonly CategoryNode[];
}

/** Nests the flat list by parentId. Orphans (parent not in the list) are shown as roots. */
export function buildCategoryTree(categories: readonly Category[]): CategoryNode[] {
  const ids = new Set(categories.map((category) => category.id));
  const byParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const parent = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), category]);
  }
  const build = (parentId: string | null, depth: number, seen: Set<string>): CategoryNode[] =>
    (byParent.get(parentId) ?? [])
      .filter((category) => !seen.has(category.id))
      .map((category) => ({
        category,
        depth,
        children: build(category.id, depth + 1, new Set([...seen, category.id])),
      }));
  return build(null, 1, new Set());
}

export function flattenTree(nodes: readonly CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function height(node: CategoryNode): number {
  return 1 + Math.max(0, ...node.children.map(height));
}

export interface ParentOption {
  readonly id: string;
  readonly label: string;
}

/**
 * Where a category may be placed: never under itself or its descendants, and never so deep that
 * it or its subtree would pass the maximum depth. The API enforces the same rules; this only
 * keeps impossible choices out of the list.
 */
export function parentOptions(tree: readonly CategoryNode[], movingId?: string): ParentOption[] {
  const all = flattenTree(tree);
  const moving = movingId ? all.find((node) => node.category.id === movingId) : undefined;
  const excluded = new Set(moving ? flattenTree([moving]).map((node) => node.category.id) : []);
  const subtreeHeight = moving ? height(moving) : 1;
  return all
    .filter((node) => node.category.status === 'ACTIVE')
    .filter((node) => !excluded.has(node.category.id))
    .filter((node) => node.depth + subtreeHeight <= MAX_CATEGORY_DEPTH)
    .map((node) => ({
      id: node.category.id,
      label: `${'— '.repeat(node.depth - 1)}${node.category.name}`,
    }));
}

/** Indented options for filters and product forms, every category included. */
export function categoryOptions(
  categories: readonly Category[],
  { activeOnly = false } = {},
): ParentOption[] {
  return flattenTree(buildCategoryTree(categories))
    .filter((node) => !activeOnly || node.category.status === 'ACTIVE')
    .map((node) => ({
      id: node.category.id,
      label: `${'— '.repeat(node.depth - 1)}${node.category.name}`,
    }));
}
