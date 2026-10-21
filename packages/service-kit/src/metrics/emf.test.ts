import { describe, expect, it } from 'vitest';
import { MAX_METRICS_PER_RECORD, toEmfLines, type EmfMetric } from './emf.js';

describe('toEmfLines', () => {
  it('writes a record CloudWatch can read as metrics', () => {
    const [line, ...rest] = toEmfLines('Solmira', 1_700_000_000_000, { Service: 'dispatcher' }, [
      { name: 'DeliveriesDue', unit: 'Count', value: 42 },
      { name: 'AttemptMs', unit: 'Milliseconds', value: { Min: 1, Max: 9, Sum: 30, Count: 6 } },
    ]);
    expect(rest).toEqual([]);

    const record = JSON.parse(line!);
    expect(record._aws).toEqual({
      Timestamp: 1_700_000_000_000,
      CloudWatchMetrics: [
        {
          Namespace: 'Solmira',
          Dimensions: [['Service']],
          Metrics: [
            { Name: 'DeliveriesDue', Unit: 'Count' },
            { Name: 'AttemptMs', Unit: 'Milliseconds' },
          ],
        },
      ],
    });
    expect(record.Service).toBe('dispatcher');
    expect(record.DeliveriesDue).toBe(42);
    expect(record.AttemptMs).toEqual({ Min: 1, Max: 9, Sum: 30, Count: 6 });
  });

  it('is one line of JSON, so a log pipeline keeps it whole', () => {
    const [line] = toEmfLines('Solmira', 1, { Service: 'x' }, [
      { name: 'A', unit: 'Count', value: 1 },
    ]);
    expect(line).not.toContain('\n');
  });

  it('lists every dimension the record carries', () => {
    const [line] = toEmfLines('Solmira', 1, { Service: 'x', Queue: 'q' }, [
      { name: 'A', unit: 'Count', value: 1 },
    ]);
    const record = JSON.parse(line!);
    expect(record._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Service', 'Queue']]);
    expect(record.Queue).toBe('q');
  });

  it('splits more metrics than the format allows into several records', () => {
    const metrics: EmfMetric[] = Array.from({ length: MAX_METRICS_PER_RECORD + 5 }, (_, i) => ({
      name: `M${i}`,
      unit: 'Count',
      value: i,
    }));
    const lines = toEmfLines('Solmira', 1, { Service: 'x' }, metrics);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)._aws.CloudWatchMetrics[0].Metrics).toHaveLength(
      MAX_METRICS_PER_RECORD,
    );
    expect(JSON.parse(lines[1]!)._aws.CloudWatchMetrics[0].Metrics).toHaveLength(5);
  });
});
