import { ValidationError } from '@solmira/service-kit';
import { expect } from 'vitest';

/** The field messages of the ValidationError thrown by `work`; fails if it throws anything else. */
export function fieldMessages(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return ((error as ValidationError).details ?? [])
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('\n');
  }
  throw new Error('Expected a ValidationError, but nothing was thrown');
}
