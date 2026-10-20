import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/**
 * The one JSON Schema engine of the service (draft 2020-12). Checking a tenant's schema when the
 * event type is saved and validating payloads later must agree, so both use this factory.
 *
 * `strict: false` accepts keywords this engine does not know instead of rejecting a tenant's
 * schema. Remote references are never fetched: with no loader, a `$ref` that does not resolve
 * inside the document fails compilation. Standard formats (email, uuid, date-time, ...) are
 * checked.
 */
export function createSchemaEngine(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false, allErrors: false, logger: false });
  addFormats.default(ajv);
  return ajv;
}
