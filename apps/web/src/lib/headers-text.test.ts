import { describe, expect, it } from 'vitest';
import { formatHeadersText, parseHeadersText } from './headers-text';

describe('parseHeadersText', () => {
  it('reads one header per line, lowercases names and trims', () => {
    expect(parseHeadersText('X-Tenant: acme\n  authorization :  Bearer abc:def \n\n')).toEqual({
      headers: { 'x-tenant': 'acme', authorization: 'Bearer abc:def' },
    });
  });

  it('accepts empty text as no headers', () => {
    expect(parseHeadersText('')).toEqual({ headers: {} });
    expect(parseHeadersText('\n \n')).toEqual({ headers: {} });
  });

  it('explains a line without a colon or with an empty name, and duplicates', () => {
    expect(parseHeadersText('x-a: 1\nnope').error).toContain('Line 2');
    expect(parseHeadersText(': value').error).toContain('Line 1');
    expect(parseHeadersText('a: 1\nA: 2').error).toContain('twice');
  });
});

describe('formatHeadersText', () => {
  it('round-trips with the parser', () => {
    const headers = { 'x-tenant': 'acme', 'x-version': '2' };
    expect(parseHeadersText(formatHeadersText(headers)).headers).toEqual(headers);
    expect(formatHeadersText({})).toBe('');
  });
});
