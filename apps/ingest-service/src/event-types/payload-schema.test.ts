import { ValidationError } from '@solmira/service-kit';
import { describe, expect, it } from 'vitest';
import { assertCompilableSchema } from './payload-schema.js';

describe('assertCompilableSchema', () => {
  it('accepts ordinary schemas, including unknown keywords and formats', () => {
    expect(() =>
      assertCompilableSchema({
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' }, 'x-note': { type: 'string' } },
        'x-internal': true,
      }),
    ).not.toThrow();
  });

  it('rejects schemas that are invalid or reference documents outside themselves', () => {
    for (const schema of [
      { type: 'nope' },
      { properties: { a: { type: 5 } } },
      { $ref: 'https://example.com/other.json' },
      { $ref: '#/$defs/missing' },
    ])
      expect(() => assertCompilableSchema(schema), JSON.stringify(schema)).toThrow(ValidationError);
  });

  it('resolves references inside the same document', () => {
    expect(() =>
      assertCompilableSchema({
        $defs: { id: { type: 'string' } },
        type: 'object',
        properties: { id: { $ref: '#/$defs/id' } },
      }),
    ).not.toThrow();
  });
});
