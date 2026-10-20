import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, describeError } from './api/client';

/** Error codes whose details name the request fields at fault. */
const FIELD_ERROR_CODES: ReadonlySet<string> = new Set(['VALIDATION_FAILED']);

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
