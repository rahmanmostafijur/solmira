import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from './canonical-json.js';

describe('canonicalJson', () => {
  it('sorts object keys at every depth and leaves array order alone', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,1,2]},"b":1}',
    );
  });

  it('serializes scalars like JSON and drops undefined members', () => {
    expect(canonicalJson({ a: undefined, b: 'x', c: 1.5, d: true })).toBe(
      '{"b":"x","c":1.5,"d":true}',
    );
    expect(canonicalJson('text')).toBe('"text"');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('requestHash', () => {
  it('is the same for equal requests however their keys are ordered', () => {
    expect(requestHash('invoice.paid', { a: 1, b: 2 })).toBe(
      requestHash('invoice.paid', { b: 2, a: 1 }),
    );
  });

  it('differs when the event type or any payload value differs', () => {
    const base = requestHash('invoice.paid', { a: 1 });
    expect(requestHash('invoice.void', { a: 1 })).not.toBe(base);
    expect(requestHash('invoice.paid', { a: 2 })).not.toBe(base);
    expect(requestHash('invoice.paid', { a: '1' })).not.toBe(base);
    expect(requestHash('invoice.paid', { a: 1, b: null })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});
