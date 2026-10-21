import { API_PREFIX, CLIENT_HEADER, apiErrorSchema, type FieldIssue } from '@solmira/contracts';

/** Headers only the client itself sets; extra headers with these names are dropped. */
const RESERVED_HEADERS = new Set([
  'accept',
  'authorization',
  'content-type',
  CLIENT_HEADER.toLowerCase(),
]);

/** A failed API call, carrying the server's stable error code and field-level details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly FieldIssue[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  readonly getAccessToken: () => string | null;
  /** Returns a fresh access token, or null when the session is gone. */
  readonly refreshAccessToken: () => Promise<string | null>;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Send the access token and refresh once on 401 (default true). */
  readonly authenticated?: boolean;
  readonly signal?: AbortSignal;
  /** Extra request headers, e.g. an Idempotency-Key. Reserved names (see RESERVED_HEADERS) are dropped. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type ApiRequest = <T>(path: string, options?: RequestOptions) => Promise<T>;

/**
 * Same-origin fetch wrapper. Access tokens travel in the Authorization header from memory;
 * the refresh token is an httpOnly cookie the browser attaches to /auth calls on its own.
 * On 401 it refreshes once and retries once, then gives up.
 */
export function createApiClient(options: ApiClientOptions): ApiRequest {
  const baseUrl = options.baseUrl ?? API_PREFIX;

  const send = (path: string, request: RequestOptions, token: string | null) => {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    // Extra headers never carry credentials or override the client's own, in any letter case.
    const extra = Object.entries(request.headers ?? {}).filter(
      ([name]) => !RESERVED_HEADERS.has(name.toLowerCase()),
    );
    const headers: Record<string, string> = {
      ...Object.fromEntries(extra),
      Accept: 'application/json',
      [CLIENT_HEADER]: 'web',
    };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetchImpl(`${baseUrl}${path}`, {
      method: request.method ?? 'GET',
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: 'same-origin',
      signal: request.signal,
    });
  };

  return async <T>(path: string, request: RequestOptions = {}): Promise<T> => {
    const authenticated = request.authenticated ?? true;
    let response = await send(path, request, authenticated ? options.getAccessToken() : null);
    if (authenticated && response.status === 401) {
      const fresh = await options.refreshAccessToken();
      if (fresh) response = await send(path, request, fresh);
    }
    return parseResponse<T>(response);
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return body as T;
  throw toApiError(response.status, body);
}

/** The error for a failed response body, whichever transport (fetch or XHR) produced it. */
export function toApiError(status: number, body: unknown): ApiError {
  const envelope = apiErrorSchema.safeParse(body);
  if (envelope.success) {
    const { code, message, details, requestId } = envelope.data.error;
    return new ApiError(status, code, message, details ?? [], requestId);
  }
  return new ApiError(status, 'UNEXPECTED_RESPONSE', 'The server returned an unexpected response');
}

/**
 * User-facing text for an error; server messages are already written for users. For a validation
 * error the first field detail says what to send instead, so it is shown over the short summary.
 */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED')
      return 'Too many attempts. Wait a few minutes and try again.';
    if (error.status >= 500) return 'Something went wrong on our side. Please try again.';
    const [first, ...others] = error.details;
    if (error.code === 'VALIDATION_FAILED' && first)
      return others.length === 0
        ? first.message
        : `${first.message} (${others.length} more problem${others.length === 1 ? '' : 's'})`;
    return error.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}
