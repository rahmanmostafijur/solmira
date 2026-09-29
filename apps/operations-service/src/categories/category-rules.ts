import { MAX_CATEGORY_DEPTH } from '@solmira/contracts';
import { ValidationError } from '@solmira/service-kit';

export interface Placement {
  /** The category being placed (undefined when creating). */
  readonly categoryId?: string;
  /** The new parent followed by its ancestors up to the root; empty for a root category. */
  readonly parentChain: readonly string[];
  /** Levels below the category being moved (0 for a leaf or a new category). */
  readonly subtreeHeight: number;
}

/**
 * Hierarchy rules for placing a category under a parent:
 *   - no cycles: a category cannot sit under itself or one of its descendants;
 *   - bounded depth: the deepest node of the moved subtree must stay within MAX_CATEGORY_DEPTH.
 */
export function assertValidPlacement({ categoryId, parentChain, subtreeHeight }: Placement): void {
  if (categoryId && parentChain.includes(categoryId)) {
    throw new ValidationError([
      {
        path: 'parentId',
        message: 'A category cannot be placed under itself or its subcategories',
      },
    ]);
  }
  const depth = parentChain.length + 1 + subtreeHeight;
  if (depth > MAX_CATEGORY_DEPTH) {
    throw new ValidationError([
      {
        path: 'parentId',
        message: `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep`,
      },
    ]);
  }
}
