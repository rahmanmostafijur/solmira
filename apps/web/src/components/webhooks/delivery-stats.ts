const EM_DASH = '—';

/** A rate from 0 to 1 as a percentage; a dash when there was nothing to measure. */
export function formatRate(rate: number | null): string {
  return rate === null ? EM_DASH : `${(rate * 100).toFixed(1)}%`;
}

/** Milliseconds as ms below a second and seconds above; a dash when there was nothing to measure. */
export function formatLatency(ms: number | null): string {
  if (ms === null) return EM_DASH;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatAttemptsPerDelivery(value: number | null): string {
  return value === null ? EM_DASH : value.toFixed(2);
}
