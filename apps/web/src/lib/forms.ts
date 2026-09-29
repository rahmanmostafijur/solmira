import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, describeError } from './api/client';

/**
 * Routes a failed submission to the form: server-side field errors land on their inputs (the
 * server validates with the same zod schemas, so paths match), everything else on the form root.
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): void {
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED' && error.details.length > 0) {
    for (const issue of error.details) {
      setError((issue.path || 'root') as Path<T>, { type: 'server', message: issue.message });
    }
    return;
  }
  setError('root' as Path<T>, { type: 'server', message: describeError(error) });
}
