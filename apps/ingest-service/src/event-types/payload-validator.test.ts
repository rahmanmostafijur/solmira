import { describe, expect, it } from 'vitest';
import { PayloadValidator } from './payload-validator.js';

const schema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' } },
};

describe('PayloadValidator', () => {
  it('accepts a valid payload and reports the path of each problem otherwise', () => {
    const validator = new PayloadValidator();
    expect(validator.validate('t1', 1, schema, { id: 'a', email: 'a@b.co' })).toEqual([]);
    const issues = validator.validate('t1', 1, schema, { id: 5 });
    expect(issues).toEqual([{ path: 'payload.id', message: 'must be string' }]);
    expect(validator.validate('t1', 1, schema, { id: 'a', email: 'nope' })[0]?.path).toBe(
      'payload.email',
    );
    expect(validator.validate('t1', 1, schema, {})[0]?.path).toBe('payload');
  });

  it('recompiles when the event type changes and keeps the old result otherwise', () => {
    const validator = new PayloadValidator();
    const strict = { type: 'object', required: ['a'] };
    expect(validator.validate('t2', 1, strict, { b: 1 })).not.toEqual([]);
    expect(validator.validate('t2', 2, { type: 'object' }, { b: 1 })).toEqual([]);
  });

  it('keeps event types apart', () => {
    const validator = new PayloadValidator();
    expect(validator.validate('a', 1, { type: 'object', required: ['x'] }, {})).not.toEqual([]);
    expect(validator.validate('b', 1, { type: 'object' }, {})).toEqual([]);
  });
});
