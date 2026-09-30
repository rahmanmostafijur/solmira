import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api/client';
import { applyServerError } from '@/lib/forms';

/**
 * Like applyServerError, but a CONFLICT with field details (over-receiving a line, editing a
 * field locked after submission) also lands on the inputs at fault instead of the form root.
 */
export function applyPurchasingError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldFor: (path: string) => string,
): void {
  if (error instanceof ApiError && error.code === 'CONFLICT' && error.details.length > 0) {
    for (const issue of error.details) {
      setError((fieldFor(issue.path) || 'root') as Path<T>, {
        type: 'server',
        message: issue.message,
      });
    }
    return;
  }
  applyServerError(error, setError, fieldFor);
}
