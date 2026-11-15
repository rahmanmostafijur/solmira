import { ApiError, isTransientError } from './client';

/** Retries of a query while a service restarts: 5 tries over about 15 seconds. */
export const MAX_TRANSIENT_RETRIES = 4;
/** Retries of any other server failure, which rarely fixes itself. */
export const MAX_OTHER_RETRIES = 2;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 8_000;

/** 4xx responses will not succeed on retry (bad input, missing permission), so fail fast. */
function isClientError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/**
 * Whether a failed query is tried again. `failureCount` is how many retries already ran (0 after
 * the first failure), as TanStack Query passes it. Mutations never use this: not all of them are
 * idempotent, so a person decides whether to send one again.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isTransientError(error)) return failureCount < MAX_TRANSIENT_RETRIES;
  return failureCount < MAX_OTHER_RETRIES && !isClientError(error);
}

/** Exponential backoff: 1, 2, 4, then 8 seconds between tries. */
export function queryRetryDelay(failureCount: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** failureCount, MAX_DELAY_MS);
}

/** The parts of a query result that tell whether it is still waiting out a restart. */
export interface RetryingQuery {
  readonly fetchStatus?: 'fetching' | 'paused' | 'idle';
  readonly failureReason?: unknown;
}

/** True while a query is being tried again after a restart-like failure. */
export function isReconnecting(query: RetryingQuery): boolean {
  return (
    query.fetchStatus !== undefined &&
    query.fetchStatus !== 'idle' &&
    isTransientError(query.failureReason)
  );
}
