import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import {
  MAX_TRANSIENT_RETRIES,
  isReconnecting,
  queryRetryDelay,
  shouldRetryQuery,
} from './retry-policy';

const unavailable = () => new ApiError(503, 'SERVICE_UNAVAILABLE', 'unavailable');

describe('shouldRetryQuery', () => {
  it('waits out a restarting service for five tries in all', () => {
    for (let failures = 0; failures < MAX_TRANSIENT_RETRIES; failures++)
      expect(shouldRetryQuery(failures, unavailable())).toBe(true);
    expect(shouldRetryQuery(MAX_TRANSIENT_RETRIES, unavailable())).toBe(false);
    expect(shouldRetryQuery(3, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, new ApiError(504, 'UNEXPECTED_RESPONSE', 'x'))).toBe(true);
  });

  it('fails fast on 4xx answers', () => {
    expect(shouldRetryQuery(0, new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(403, 'FORBIDDEN', 'x'))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(429, 'RATE_LIMITED', 'x'))).toBe(false);
  });

  it('tries other server failures only twice more', () => {
    const internal = new ApiError(500, 'INTERNAL_ERROR', 'x');
    expect(shouldRetryQuery(1, internal)).toBe(true);
    expect(shouldRetryQuery(2, internal)).toBe(false);
  });
});

describe('queryRetryDelay', () => {
  it('backs off exponentially, about 15 seconds over all retries', () => {
    const delays = Array.from({ length: MAX_TRANSIENT_RETRIES }, (_, n) => queryRetryDelay(n));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(queryRetryDelay(10)).toBe(8_000);
  });
});

describe('isReconnecting', () => {
  it('is true only while a query is fetching again after a transient failure', () => {
    expect(isReconnecting({ fetchStatus: 'fetching', failureReason: unavailable() })).toBe(true);
    expect(isReconnecting({ fetchStatus: 'idle', failureReason: unavailable() })).toBe(false);
    expect(isReconnecting({ fetchStatus: 'fetching', failureReason: null })).toBe(false);
    expect(
      isReconnecting({
        fetchStatus: 'fetching',
        failureReason: new ApiError(500, 'INTERNAL_ERROR', 'x'),
      }),
    ).toBe(false);
    expect(isReconnecting({})).toBe(false);
  });
});

describe('the policy in a query client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const client = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay } },
    });

  it('succeeds once the service is back', async () => {
    vi.useFakeTimers();
    const queryFn = vi
      .fn()
      .mockRejectedValueOnce(unavailable())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true });

    const result = client().fetchQuery({ queryKey: ['x'], queryFn });
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toEqual({ ok: true });
    expect(queryFn).toHaveBeenCalledTimes(3);
  });

  it('gives up after five tries and reports the last failure', async () => {
    vi.useFakeTimers();
    const queryFn = vi.fn().mockRejectedValue(unavailable());

    const result = client().fetchQuery({ queryKey: ['x'], queryFn });
    const settled = expect(result).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(16_000);

    await settled;
    expect(queryFn).toHaveBeenCalledTimes(MAX_TRANSIENT_RETRIES + 1);
  });

  it('does not repeat a 4xx answer', async () => {
    const queryFn = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found'));

    await expect(client().fetchQuery({ queryKey: ['x'], queryFn })).rejects.toMatchObject({
      status: 404,
    });
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});
