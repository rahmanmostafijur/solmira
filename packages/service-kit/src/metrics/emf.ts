/**
 * CloudWatch Embedded Metric Format: a metric is a JSON log line, and CloudWatch Logs turns it into
 * a metric by itself. No agent, no sidecar, no SDK call from the application, and the same line is
 * readable in the log when something has to be explained.
 * https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 */

export type MetricUnit = 'Count' | 'Seconds' | 'Milliseconds' | 'Bytes' | 'Percent' | 'None';

/** A summary of many observations in one window; CloudWatch reads Min, Max, Sum and Count. */
export interface StatisticSet {
  readonly Min: number;
  readonly Max: number;
  readonly Sum: number;
  readonly Count: number;
}

export interface EmfMetric {
  readonly name: string;
  readonly unit: MetricUnit;
  readonly value: number | StatisticSet;
}

/** CloudWatch accepts at most this many metrics in one directive. */
export const MAX_METRICS_PER_RECORD = 100;

/**
 * Encodes metrics that share one set of dimensions as EMF lines. Dimension values are strings, as
 * the format requires; metrics are split across lines if there are more than the format allows.
 */
export function toEmfLines(
  namespace: string,
  timestamp: number,
  dimensions: Readonly<Record<string, string>>,
  metrics: readonly EmfMetric[],
): string[] {
  const lines: string[] = [];
  for (let start = 0; start < metrics.length; start += MAX_METRICS_PER_RECORD) {
    const chunk = metrics.slice(start, start + MAX_METRICS_PER_RECORD);
    const record: Record<string, unknown> = {
      _aws: {
        Timestamp: timestamp,
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [Object.keys(dimensions)],
            Metrics: chunk.map((metric) => ({ Name: metric.name, Unit: metric.unit })),
          },
        ],
      },
      ...dimensions,
    };
    for (const metric of chunk) record[metric.name] = metric.value;
    lines.push(JSON.stringify(record));
  }
  return lines;
}
