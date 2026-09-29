const UNIQUE_VIOLATION = '23505';

/** Drizzle wraps driver errors; the PostgreSQL SQLSTATE lives on the error or its cause. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return false;
    const { code, constraint: name } = candidate as { code?: unknown; constraint?: unknown };
    return code === UNIQUE_VIOLATION && (constraint === undefined || name === constraint);
  });
}
