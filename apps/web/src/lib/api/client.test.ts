import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, describeError } from './client';

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

    await api('/purchase-orders/x/receipts', {
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
});
