import { describe, expect, it } from 'vitest';
import { escapeLike, offsetOf } from './query.js';

describe('escapeLike', () => {
  it('neutralises LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\now')).toBe('50\\%\\_off\\\\now');
    expect(escapeLike("o'brien; drop table")).toBe("o'brien; drop table");
  });
});

describe('offsetOf', () => {
  it('turns page numbers into row offsets', () => {
    expect(offsetOf({ page: 1, pageSize: 25 })).toBe(0);
    expect(offsetOf({ page: 3, pageSize: 25 })).toBe(50);
  });
});
