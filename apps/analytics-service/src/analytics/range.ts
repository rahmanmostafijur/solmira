import { DEFAULT_ANALYTICS_RANGE_HOURS, type AnalyticsRangeQuery } from '@solmira/contracts';

export interface ResolvedRange {
  readonly from: Date;
  readonly to: Date;
}

/** Fills in the defaults of a validated range: the last 24 hours up to now. */
export function resolveRange(query: AnalyticsRangeQuery, now: Date = new Date()): ResolvedRange {
  const to = query.to ? new Date(query.to) : now;
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_ANALYTICS_RANGE_HOURS * 3_600_000);
  return { from, to };
}
