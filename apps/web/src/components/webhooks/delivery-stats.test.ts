import { describe, expect, it } from 'vitest';
import { formatAttemptsPerDelivery, formatLatency, formatRate } from './delivery-stats';

describe('delivery statistics formatting', () => {
  it('shows a dash instead of a number when nothing was measured', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatLatency(null)).toBe('—');
    expect(formatAttemptsPerDelivery(null)).toBe('—');
  });

  it('formats rates as percentages', () => {
    expect(formatRate(0.9)).toBe('90.0%');
    expect(formatRate(1)).toBe('100.0%');
    expect(formatRate(0)).toBe('0.0%');
  });

  it('formats latency in ms below a second and in seconds above', () => {
    expect(formatLatency(50.5)).toBe('51 ms');
    expect(formatLatency(999)).toBe('999 ms');
    expect(formatLatency(1000)).toBe('1.00 s');
    expect(formatLatency(2345)).toBe('2.35 s');
  });

  it('formats attempts per delivery with two decimals', () => {
    expect(formatAttemptsPerDelivery(1)).toBe('1.00');
    expect(formatAttemptsPerDelivery(1.0476)).toBe('1.05');
  });
});
