import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { toEmfLines, type EmfMetric, type MetricUnit, type StatisticSet } from './emf.js';

export const METRICS_NAMESPACE = 'Solmira';
const FLUSH_INTERVAL_MS = 60_000;

export interface MetricsOptions {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly namespace?: string;
  readonly flushIntervalMs?: number;
  readonly write?: (line: string) => void;
  readonly now?: () => number;
}

type Dimensions = Readonly<Record<string, string>>;
type Collector = () => Promise<void>;

interface Series {
  readonly dimensions: Dimensions;
  readonly name: string;
  readonly unit: MetricUnit;
  readonly kind: 'count' | 'gauge' | 'observation';
  sum: number;
  min: number;
  max: number;
  count: number;
  last: number;
}

/**
 * Collects the numbers a service wants on a dashboard and writes them once a minute (ADR-0039).
 * Counters add up over the window, gauges report the latest value, observations report their
 * minimum, maximum, sum and count. When disabled (the default outside AWS) every call does nothing.
 * Dimensions always include the service name; add others sparingly, each combination is a metric
 * that is billed.
 */
@Injectable()
export class MetricsRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger('Metrics');
  private readonly series = new Map<string, Series>();
  private readonly collectors: Collector[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: MetricsOptions) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  /** Starts the periodic flush. Call once the service is up. */
  start(): void {
    if (!this.options.enabled || this.timer) return;
    const interval = this.options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.timer = setInterval(() => void this.flush(), interval);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  /** Adds `value` (default 1) to a counter. */
  count(name: string, value = 1, dimensions: Dimensions = {}): void {
    this.record(name, 'Count', 'count', value, dimensions);
  }

  /** Reports a value that goes up and down (a backlog, a queue depth): the latest in the window wins. */
  gauge(
    name: string,
    value: number,
    unit: MetricUnit = 'Count',
    dimensions: Dimensions = {},
  ): void {
    this.record(name, unit, 'gauge', value, dimensions);
  }

  /** Records one observation (a duration, a size) in the window's statistics. */
  observe(name: string, value: number, unit: MetricUnit, dimensions: Dimensions = {}): void {
    this.record(name, unit, 'observation', value, dimensions);
  }

  /** Registers a function that samples gauges right before each flush (a backlog is read, not pushed). */
  collect(collector: Collector): void {
    if (this.options.enabled) this.collectors.push(collector);
  }

  /** Samples the collectors, writes what has accumulated, and starts a new window. */
  async flush(): Promise<void> {
    if (!this.options.enabled) return;
    for (const collector of this.collectors) {
      try {
        await collector();
      } catch (error) {
        // A failed sample is a gap in a graph, never a reason to stop the service.
        this.logger.warn({ err: error }, 'A metrics collector failed');
      }
    }
    const write = this.options.write ?? ((line: string) => void process.stdout.write(line + '\n'));
    const timestamp = (this.options.now ?? Date.now)();
    const namespace = this.options.namespace ?? METRICS_NAMESPACE;
    const groups = new Map<string, { dimensions: Dimensions; metrics: EmfMetric[] }>();
    for (const series of this.series.values()) {
      const key = JSON.stringify(series.dimensions);
      const group = groups.get(key) ?? { dimensions: series.dimensions, metrics: [] };
      group.metrics.push({ name: series.name, unit: series.unit, value: summarize(series) });
      groups.set(key, group);
    }
    this.series.clear();
    for (const { dimensions, metrics } of groups.values()) {
      for (const line of toEmfLines(namespace, timestamp, dimensions, metrics)) write(line);
    }
  }

  private record(
    name: string,
    unit: MetricUnit,
    kind: Series['kind'],
    value: number,
    extra: Dimensions,
  ): void {
    if (!this.options.enabled || !Number.isFinite(value)) return;
    const dimensions = { Service: this.options.serviceName, ...extra };
    const key = `${kind}|${name}|${JSON.stringify(dimensions)}`;
    const existing = this.series.get(key);
    if (existing) {
      existing.sum += value;
      existing.count += 1;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
      existing.last = value;
      return;
    }
    this.series.set(key, {
      dimensions,
      name,
      unit,
      kind,
      sum: value,
      min: value,
      max: value,
      count: 1,
      last: value,
    });
  }
}

function summarize(series: Series): number | StatisticSet {
  if (series.kind === 'count') return series.sum;
  if (series.kind === 'gauge') return series.last;
  return { Min: series.min, Max: series.max, Sum: series.sum, Count: series.count };
}
