import { toPage, type Page, type PaginationQuery } from '@solmira/contracts';
import { ConflictError, NotFoundError, ValidationError } from '@solmira/service-kit';
import { sql, type SQL } from 'drizzle-orm';
import { violatedConstraint } from '../database/errors.js';

/**
 * Escapes LIKE wildcards so user search text matches literally ("50%" finds "50%", not "50…").
 * The value is still sent as a bound parameter; this only neutralises the wildcard meaning.
 */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Case-insensitive "contains" condition for a column, safe for arbitrary user input. */
export function contains(column: SQL | SQL.Aliased | object, term: string): SQL {
  return sql`${column} ilike ${`%${escapeLike(term)}%`}`;
}

export function offsetOf(query: PaginationQuery): number {
  return (query.page - 1) * query.pageSize;
}

export function pageOf<T>(items: T[], total: number, query: PaginationQuery): Page<T> {
  return toPage(items, total, query);
}

export const iso = (value: Date) => value.toISOString();

export function orNotFound<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new NotFoundError(`${what} not found`);
  return value;
}

/** A referenced record that does not exist in this organization, reported as a field error. */
export function referenceError(field: string, what: string): ValidationError {
  return new ValidationError([{ path: field, message: `${what} not found` }]);
}

/**
 * Maps unique-constraint violations to user-facing conflicts, and rethrows anything else. The
 * constraint name decides the message; database details never reach the client.
 */
export function rethrowConflict(error: unknown, messages: Readonly<Record<string, string>>): never {
  const constraint = violatedConstraint(error, 'unique');
  if (constraint !== undefined && messages[constraint])
    throw new ConflictError(messages[constraint]);
  throw error;
}
