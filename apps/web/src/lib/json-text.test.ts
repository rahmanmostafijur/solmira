import { describe, expect, it } from 'vitest';
import { parseJsonObject, prettyJson } from './json-text';

describe('parseJsonObject', () => {
  it('returns the object for valid JSON', () => {
    expect(parseJsonObject('{"type": "object"}')).toEqual({ value: { type: 'object' } });
  });

  it('rejects syntax errors and anything that is not an object', () => {
    expect('error' in parseJsonObject('{nope')).toBe(true);
    for (const text of ['[]', '"x"', '12', 'null', 'true'])
      expect(parseJsonObject(text), text).toHaveProperty('error');
  });
});

describe('prettyJson', () => {
  it('indents by two spaces', () => {
    expect(prettyJson({ a: { b: 1 } })).toBe('{\n  "a": {\n    "b": 1\n  }\n}');
  });
});
