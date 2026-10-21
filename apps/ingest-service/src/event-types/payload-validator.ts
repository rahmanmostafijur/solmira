import { Injectable } from '@nestjs/common';
import type { FieldIssue } from '@solmira/contracts';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import { createSchemaEngine } from './json-schema.js';

interface CompiledSchema {
  readonly version: number;
  readonly validate: ValidateFunction;
}

const MAX_CACHED_SCHEMAS = 500;

/** Where an invalid payload went wrong, as field issues a tenant can act on. */
function issuesOf(validate: ValidateFunction): FieldIssue[] {
  return (validate.errors ?? []).slice(0, 10).map((error) => {
    const path = ['payload', ...error.instancePath.split('/').filter(Boolean)].join('.');
    // Ajv words the rule ("must be string"); the path makes it a sentence about one field.
    return { path, message: `${path} ${error.message ?? 'is invalid'}` };
  });
}

/**
 * Validates message payloads against the JSON Schema of their event type. Compiled validators are
 * cached per event type and invalidated when the event type changes, so a hot event type compiles
 * once. The cache is bounded; the oldest entry leaves first.
 */
@Injectable()
export class PayloadValidator {
  private readonly engine = createSchemaEngine();
  private readonly cache = new Map<string, CompiledSchema>();

  /** `version` identifies the stored schema (its last update); a new version recompiles. */
  validate(
    eventTypeId: string,
    version: number,
    schema: Record<string, unknown>,
    payload: unknown,
  ): FieldIssue[] {
    const compiled = this.compiled(eventTypeId, version, schema);
    return compiled.validate(payload) ? [] : issuesOf(compiled.validate);
  }

  private compiled(eventTypeId: string, version: number, schema: Record<string, unknown>) {
    const cached = this.cache.get(eventTypeId);
    if (cached?.version === version) return cached;
    const fresh = { version, validate: this.engine.compile(structuredClone(schema)) };
    this.cache.delete(eventTypeId);
    this.cache.set(eventTypeId, fresh);
    if (this.cache.size > MAX_CACHED_SCHEMAS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return fresh;
  }
}
