import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, describeError } from './api/client';

/** Error codes whose details name the request fields at fault. */
const FIELD_ERROR_CODES: ReadonlySet<string> = new Set(['VALIDATION_FAILED']);

/** The parts of a react-hook-form form that server errors are routed through. */
export interface ServerErrorTarget<T extends FieldValues> {
  readonly setError: UseFormSetError<T>;
  readonly getValues: () => T;
}

/**
 * The form field that shows a request path: the path itself when the form has it, else its
 * top-level field (a `headers.x-tenant` error belongs on a `headers` input), else none.
 */
function formFieldOf(values: Record<string, unknown>, path: string): string | undefined {
  if (path === '' || path === 'root') return undefined;
  const [top = ''] = path.split('.');
  if (!(top in values)) return undefined;
  const exact = path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        typeof value === 'object' && value !== null
          ? (value as Record<string, unknown>)[key]
          : undefined,
      values,
    );
  return exact === undefined ? top : path;
}

/**
 * Routes a failed submission to the form: server-side field errors land on their inputs (the
 * server validates with the same zod schemas, so paths match), everything else on the form root.
 * `fieldFor` translates a request path to the form field showing it, for forms whose fields are
 * shaped differently from the request (return '' or 'root' to show it on the form itself). A
 * detail for a field the form does not have is shown on the root too, never dropped.
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  form: ServerErrorTarget<T>,
  fieldFor: (path: string) => string = (path) => path,
): void {
  if (error instanceof ApiError && FIELD_ERROR_CODES.has(error.code) && error.details.length > 0) {
    const values = (form.getValues() ?? {}) as Record<string, unknown>;
    const unplaced: string[] = [];
    for (const issue of error.details) {
      const field = formFieldOf(values, fieldFor(issue.path));
      if (field) form.setError(field as Path<T>, { type: 'server', message: issue.message });
      else unplaced.push(issue.message);
    }
    if (unplaced.length > 0)
      form.setError('root' as Path<T>, { type: 'server', message: unplaced.join(' ') });
    return;
  }
  form.setError('root' as Path<T>, { type: 'server', message: describeError(error) });
}
