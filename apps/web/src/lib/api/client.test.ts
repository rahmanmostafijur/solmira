import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, describeError, isTransientError, toApiError } from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createApiClient', () => {
  it('sends the access token, the first-party client header and same-origin credentials', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    const api = createApiClient({
      getAccessToken: () => 'token-1',
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await api('/me');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'x-solmira-client': 'web',
    });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { id: 'x' }));
    const refresh = vi.fn(async () => 'token-2');
    const api = createApiClient({
      getAccessToken: () => 'token-1',
      refreshAccessToken: refresh,
      fetch: fetchMock,
    });

    await expect(api('/me')).resolves.toEqual({ id: 'x' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-2',
    });
  });

  it('gives up when the session cannot be refreshed', async () => {
    const fetchMock = vi.fn(async () =>
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }),
    );
    const api = createApiClient({
      getAccessToken: () => 't',
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await expect(api('/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never refreshes for unauthenticated calls such as login', async () => {
    const refresh = vi.fn(async () => 't');
    const fetchMock = vi.fn(async () =>
      json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Wrong' } }),
    );
    const api = createApiClient({
      getAccessToken: () => null,
      refreshAccessToken: refresh,
      fetch: fetchMock,
    });

    await expect(
      api('/auth/login', { method: 'POST', body: {}, authenticated: false }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends extra headers without letting them replace its own', async () => {
    const fetchMock = vi.fn(async () => json(201, { id: 'r' }));
    const api = createApiClient({
      getAccessToken: () => 'token-1',
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await api('/applications/x/messages', {
      method: 'POST',
      body: {},
      headers: { 'idempotency-key': 'key-12345', Authorization: 'forged', 'x-solmira-client': 'x' },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      'idempotency-key': 'key-12345',
      Authorization: 'Bearer token-1',
      'x-solmira-client': 'web',
    });
  });

  it('drops reserved extra headers in any letter case, even without a token', async () => {
    const fetchMock = vi.fn(async () => json(200, {}));
    const api = createApiClient({
      getAccessToken: () => null,
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await api('/anything', {
      headers: { authorization: 'Bearer forged', ACCEPT: 'text/html', 'X-Solmira-Client': 'x' },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const names = Object.keys(init.headers as Record<string, string>).map((n) => n.toLowerCase());
    expect(names).not.toContain('authorization');
    expect(names.filter((name) => name === 'accept')).toHaveLength(1);
    expect(init.headers).toMatchObject({ Accept: 'application/json', 'x-solmira-client': 'web' });
  });

  it('surfaces field-level validation details', async () => {
    const fetchMock = vi.fn(async () =>
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid',
          details: [{ path: 'email', message: 'Bad' }],
        },
      }),
    );
    const api = createApiClient({
      getAccessToken: () => null,
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await expect(api('/x', { authenticated: false })).rejects.toMatchObject({
      details: [{ path: 'email', message: 'Bad' }],
    });
  });

  it('keeps the Retry-After of a throttled answer', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '120' },
        }),
    );
    const api = createApiClient({
      getAccessToken: () => 't',
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await expect(api('/me/password', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 120,
    });
  });

  it('reports the gateway answer for a restarting service as SERVICE_UNAVAILABLE', async () => {
    const fetchMock = vi.fn(async () =>
      json(503, {
        error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable' },
      }),
    );
    const api = createApiClient({
      getAccessToken: () => 't',
      refreshAccessToken: async () => null,
      fetch: fetchMock,
    });

    await expect(api('/applications')).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isTransientError', () => {
  it('is true for a restarting service and for a request that never got an answer', () => {
    expect(isTransientError(new ApiError(503, 'SERVICE_UNAVAILABLE', 'x'))).toBe(true);
    expect(isTransientError(new ApiError(502, 'UNEXPECTED_RESPONSE', 'x'))).toBe(true);
    expect(isTransientError(new ApiError(504, 'UNEXPECTED_RESPONSE', 'x'))).toBe(true);
    expect(isTransientError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('is false for answers that a retry would not change', () => {
    expect(isTransientError(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(false);
    expect(isTransientError(new ApiError(400, 'VALIDATION_FAILED', 'x'))).toBe(false);
    expect(isTransientError(new ApiError(429, 'RATE_LIMITED', 'x'))).toBe(false);
    expect(isTransientError(new DOMException('aborted', 'AbortError'))).toBe(false);
  });
});

describe('describeError', () => {
  it('hides server failures and network errors behind friendly text', () => {
    expect(describeError(new ApiError(500, 'INTERNAL_ERROR', 'stack trace'))).not.toContain(
      'stack',
    );
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/connection/);
    expect(describeError(new ApiError(409, 'CONFLICT', 'Already a member'))).toBe(
      'Already a member',
    );
  });

  it('says a service is restarting for the gateway answers of a restart', () => {
    const restarting = /A Solmira service is restarting\. Try again in a few seconds\./;
    expect(describeError(new ApiError(503, 'SERVICE_UNAVAILABLE', 'unavailable'))).toMatch(
      restarting,
    );
    expect(describeError(new ApiError(502, 'UNEXPECTED_RESPONSE', 'bad gateway'))).toMatch(
      restarting,
    );
    expect(describeError(new ApiError(504, 'UNEXPECTED_RESPONSE', 'timeout'))).toMatch(restarting);
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/restarting/);
    expect(describeError(new ApiError(500, 'INTERNAL_ERROR', 'boom'))).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('says how long to wait when the server sent Retry-After', () => {
    const limited = (seconds?: number) =>
      new ApiError(429, 'RATE_LIMITED', 'Too many', [], undefined, seconds);
    expect(describeError(limited(30))).toBe('Too many attempts. Try again in 30 seconds.');
    expect(describeError(limited(900))).toBe('Too many attempts. Try again in 15 minutes.');
    expect(describeError(limited(61))).toBe('Too many attempts. Try again in 2 minutes.');
    expect(describeError(limited())).toBe('Too many attempts. Wait a few minutes and try again.');
  });

  it('shows what to send for a validation error, not only its summary', () => {
    const detail = {
      path: 'Idempotency-Key',
      rule: 'too_short',
      message: 'Idempotency-Key must be 8 to 100 characters long; got 5. Example: order-1234',
    };
    const one = new ApiError(400, 'VALIDATION_FAILED', 'Idempotency-Key is too short', [detail]);
    expect(describeError(one)).toBe(detail.message);
    const three = new ApiError(400, 'VALIDATION_FAILED', 'Idempotency-Key is too short', [
      detail,
      { path: 'eventType', message: 'eventType is required.' },
      { path: 'payload', message: 'payload is required.' },
    ]);
    expect(describeError(three)).toBe(`${detail.message} (2 more problems)`);
    expect(describeError(new ApiError(400, 'VALIDATION_FAILED', 'Nothing to update'))).toBe(
      'Nothing to update',
    );
  });

  it('keeps the rule and example of field details from the server', () => {
    const error = toApiError(400, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'name is too long',
        details: [{ path: 'name', message: 'Too long', rule: 'too_long', maximum: 100 }],
      },
    });
    expect(error.details).toEqual([
      { path: 'name', message: 'Too long', rule: 'too_long', maximum: 100 },
    ]);
  });
});
