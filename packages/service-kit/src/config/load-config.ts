import type { z } from 'zod';

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'ConfigValidationError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Parses the environment once at startup and fails fast. Error messages name the variable
 * and the rule it broke but never echo the value, so secrets cannot end up in crash logs.
 */
export function loadConfig<S extends z.ZodType>(
  schema: S,
  env: Env = process.env,
): Readonly<z.output<S>> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues.map(formatIssue));
  }
  return Object.freeze(result.data);
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join('.') || '(root)';
  return `${path}: ${issue.message}`;
}
