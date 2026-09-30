import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, describeError } from './api/client';

/** Error codes whose details name the request fields at fault. */
const FIELD_ERROR_CODES: ReadonlySet<string> = new Set(['VALIDATION_FAILED', 'INSUFFICIENT_STOCK']);

/**
 * Routes a failed submission to the form: server-side field errors land on their inputs (the
 * server validates with the same zod schemas, so paths match), everything else on the form root.
 * `fieldFor` translates a request path to the form field showing it, for forms whose fields are
 * shaped differently from the request (return '' or 'root' to show it on the form itself).
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldFor: (path: string) => string = (path) => path,
): void {
  if (error instanceof ApiError && FIELD_ERROR_CODES.has(error.code) && error.details.length > 0) {
    for (const issue of error.details) {
      setError((fieldFor(issue.path) || 'root') as Path<T>, {
        type: 'server',
        message: issue.message,
      });
    }
    return;
  }
  setError('root' as Path<T>, { type: 'server', message: describeError(error) });
}

/**
 * The part of an update request the user actually changed (react-hook-form's dirty fields), so
 * saving one field never overwrites another someone else edited meanwhile. Null when unchanged.
 */
export function pickDirty<T extends object>(
  request: T,
  dirty: Partial<Record<keyof T, unknown>>,
): Partial<T> | null {
  const changed = Object.fromEntries(
    Object.entries(request).filter(([key]) => Boolean(dirty[key as keyof T])),
  ) as Partial<T>;
  return Object.keys(changed).length > 0 ? changed : null;
}
