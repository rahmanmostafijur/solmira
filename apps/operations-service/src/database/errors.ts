const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
// ON DELETE RESTRICT reports its own SQLSTATE rather than 23503.
const RESTRICT_VIOLATION = '23001';

type PgError = { code?: unknown; constraint?: unknown };

function pgErrorOf(error: unknown): PgError | undefined {
  // Drizzle wraps driver errors; the PostgreSQL SQLSTATE lives on the error or its cause.
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate)
      return candidate as PgError;
  }
  return undefined;
}

export function violatedConstraint(
  error: unknown,
  kind: 'unique' | 'foreign_key',
): string | undefined {
  const pgError = pgErrorOf(error);
  const expected =
    kind === 'unique' ? [UNIQUE_VIOLATION] : [FOREIGN_KEY_VIOLATION, RESTRICT_VIOLATION];
  if (typeof pgError?.code !== 'string' || !expected.includes(pgError.code)) return undefined;
  return typeof pgError.constraint === 'string' ? pgError.constraint : '';
}
