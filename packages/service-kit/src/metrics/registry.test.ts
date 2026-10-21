import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './registry.js';

function setup(enabled = true) {
  const lines: Record<string, unknown>[] = [];
  const registry = new MetricsRegistry({
    enabled,
    serviceName: 'dispatcher',
    now: () => 1_700_000_000_000,
    write: (line) => lines.push(JSON.parse(line)),
  });
  return { registry, lines };
}

describe('MetricsRegistry', () => {
  it('adds counters up over the window and starts the next window from zero', async () => {
    const { registry, lines } = setup();
    registry.count('Attempts');
    registry.count('Attempts', 4);
    await registry.flush();
    registry.count('Attempts');
    await registry.flush();

    expect(lines.map((line) => line.Attempts)).toEqual([5, 1]);
    expect(lines[0]).toMatchObject({ Service: 'dispatcher' });
  });

  it('reports the latest value of a gauge', async () => {
    const { registry, lines } = setup();
    registry.gauge('DeliveriesDue', 10);
    registry.gauge('DeliveriesDue', 3);
    await registry.flush();
    expect(lines[0]!.DeliveriesDue).toBe(3);
  });

  it('summarizes observations as a statistic set', async () => {
    const { registry, lines } = setup();
    for (const value of [5, 1, 9, 5]) registry.observe('AttemptMs', value, 'Milliseconds');
    await registry.flush();
    expect(lines[0]!.AttemptMs).toEqual({ Min: 1, Max: 9, Sum: 20, Count: 4 });
  });

  it('keeps metrics with different dimensions apart, one record per dimension set', async () => {
    const { registry, lines } = setup();
    registry.count('Attempts', 3, { Result: 'succeeded' });
    registry.count('Attempts', 2, { Result: 'failed' });
    registry.gauge('DeliveriesDue', 7);
    await registry.flush();

    expect(lines).toHaveLength(3);
    const byResult = Object.fromEntries(
      lines.filter((line) => line.Result).map((line) => [line.Result, line.Attempts]),
    );
    expect(byResult).toEqual({ succeeded: 3, failed: 2 });
  });

  it('samples collectors just before it writes, and survives one that fails', async () => {
    const { registry, lines } = setup();
    registry.collect(async () => {
      throw new Error('database unreachable');
    });
    registry.collect(async () => registry.gauge('OutboxUnpublished', 12));
    await registry.flush();
    expect(lines[0]!.OutboxUnpublished).toBe(12);
  });

  it('does nothing when disabled, and ignores values that are not numbers', async () => {
    const off = setup(false);
    off.registry.count('Attempts');
    off.registry.collect(async () => off.registry.gauge('X', 1));
    await off.registry.flush();
    expect(off.lines).toEqual([]);

    const on = setup();
    on.registry.gauge('Broken', Number.NaN);
    on.registry.count('Broken', Number.POSITIVE_INFINITY);
    await on.registry.flush();
    expect(on.lines).toEqual([]);
  });

  it('writes what is left at shutdown', async () => {
    const { registry, lines } = setup();
    registry.count('Attempts', 2);
    await registry.onApplicationShutdown();
    expect(lines[0]!.Attempts).toBe(2);
  });
});
