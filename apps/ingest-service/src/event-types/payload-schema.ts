import { ValidationError } from '@solmira/service-kit';
import { createSchemaEngine } from './json-schema.js';

const engine = createSchemaEngine();

/** Rejects a document that is not a valid, self-contained JSON Schema (draft 2020-12). */
export function assertCompilableSchema(schema: Record<string, unknown>): void {
  try {
    engine.compile(schema);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid schema';
    throw new ValidationError([{ path: 'schema', message: `Not a valid JSON Schema: ${reason}` }]);
  } finally {
    // Compiled schemas are cached by identity; this check must not grow the cache.
    engine.removeSchema(schema);
  }
}
