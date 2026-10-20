export interface RetryPolicy {
  /** Seconds to wait before attempt 1, 2, 3, ...; the length is the number of attempts. */
  readonly schedule: readonly number[];
  /** Each delay is multiplied by a random factor within plus or minus this ratio. */
  readonly jitterRatio: number;
}

export type NextAttempt =
  | { readonly exhausted: true }
  | { readonly exhausted: false; readonly delayMs: number; readonly at: Date };

/** The number of attempts a delivery gets before it is marked failed. */
export function maxAttempts(policy: RetryPolicy): number {
  return policy.schedule.length;
}

/**
 * When to try again after attempt `finishedAttempt` (1-based) failed. The wait before attempt n + 1
 * is `schedule[n]`. A wait of zero stays zero; the others are spread by the jitter ratio so a
 * burst of failures does not return as a burst of retries.
 */
export function nextAttempt(
  policy: RetryPolicy,
  finishedAttempt: number,
  now: Date,
  random: () => number = Math.random,
): NextAttempt {
  const seconds = policy.schedule[finishedAttempt];
  if (seconds === undefined) return { exhausted: true };
  const factor = 1 + (random() * 2 - 1) * policy.jitterRatio;
  const delayMs = Math.round(seconds * 1000 * factor);
  return { exhausted: false, delayMs, at: new Date(now.getTime() + delayMs) };
}
