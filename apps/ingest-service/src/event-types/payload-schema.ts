import { ValidationError } from '@solmira/service-kit';
import Ajv2020 from 'ajv/dist/2020.js';

// `strict: false` accepts keywords and formats this validator does not know instead of rejecting
// the tenant's schema. Remote references are never fetched: with no loader, a `$ref` that does not
// resolve inside the document fails compilation.
const ajv = new Ajv2020.default({ strict: false, validateFormats: false, logger: false });

/** Rejects a document that is not a valid, self-contained JSON Schema (draft 2020-12). */
export function assertCompilableSchema(schema: Record<string, unknown>): void {
  try {
    ajv.compile(schema);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid schema';
    throw new ValidationError([{ path: 'schema', message: `Not a valid JSON Schema: ${reason}` }]);
  } finally {
    // Compiled schemas are cached by identity; this check must not grow the cache.
    ajv.removeSchema(schema);
  }
}
