import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Offset pagination for back-office tables: users jump between numbered pages and need a total.
 * The page size is capped so no request can ask for an unbounded result set.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

export interface Page<T> {
  readonly items: T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export function toPage<T>(items: T[], total: number, query: PaginationQuery): Page<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** Optional trimmed search text; blank strings mean "no filter" rather than "match nothing". */
export const searchTermSchema = z
  .string()
  .trim()
  .max(100)
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();
