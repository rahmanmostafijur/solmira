import { describe, expect, it } from 'vitest';
import { formatMoney, fromMinorUnits, minorDigits, toMinorUnits } from './money';

describe('money', () => {
  it('knows how many decimals each currency uses', () => {
    expect(minorDigits('USD')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('BHD')).toBe(3);
  });

  it('parses user input into exact minor units without floating-point drift', () => {
    expect(toMinorUnits('12.5', 'USD')).toBe(1250);
    expect(toMinorUnits('0.29', 'USD')).toBe(29);
    expect(toMinorUnits('19.99', 'EUR')).toBe(1999);
    expect(toMinorUnits(' 7 ', 'USD')).toBe(700);
    expect(toMinorUnits('1500', 'JPY')).toBe(1500);
    expect(toMinorUnits('1.234', 'BHD')).toBe(1234);
  });

  it('rejects negative, malformed and over-precise amounts', () => {
    for (const input of ['-1', 'abc', '1.234', '1,50', '', '.5', '1e3']) {
      expect(toMinorUnits(input, 'USD'), input).toBeNull();
    }
    expect(toMinorUnits('10.5', 'JPY')).toBeNull();
  });

  it('formats and round-trips amounts', () => {
    expect(formatMoney(899, 'USD', 'en-US')).toBe('$8.99');
    expect(fromMinorUnits(1250, 'USD')).toBe('12.50');
    expect(toMinorUnits(fromMinorUnits(123456, 'USD'), 'USD')).toBe(123456);
  });
});
