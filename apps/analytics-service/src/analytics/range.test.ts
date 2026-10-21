import { describe, expect, it } from 'vitest';
import { resolveRange } from './range.js';

const NOW = new Date('2026-10-21T12:00:00.000Z');

describe('resolveRange', () => {
  it('defaults to the last 24 hours', () => {
    const range = resolveRange({}, NOW);
    expect(range.to).toEqual(NOW);
    expect(range.from).toEqual(new Date('2026-10-20T12:00:00.000Z'));
  });

  it('counts the default window back from an explicit end', () => {
    const range = resolveRange({ to: '2026-10-10T00:00:00.000Z' }, NOW);
    expect(range.from).toEqual(new Date('2026-10-09T00:00:00.000Z'));
  });

  it('keeps an explicit range as given', () => {
    const range = resolveRange(
      { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' },
      NOW,
    );
    expect(range.from).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(range.to).toEqual(new Date('2026-10-02T00:00:00.000Z'));
  });
});
