import { API_PREFIX, CLIENT_HEADER, REFRESH_COOKIE, SESSION_HINT_COOKIE } from '@solmira/contracts';
import { ForbiddenError } from '@solmira/service-kit';
import type { CookieOptions, Request, Response } from 'express';
import type { IssuedRefreshToken } from './sessions.service.js';

/** The refresh cookie is only ever sent to the auth endpoints, never to the rest of the API. */
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

function refreshCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: REFRESH_COOKIE_PATH };
}

function hintCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/' };
}

export function setAuthCookies(
  response: Response,
  refresh: IssuedRefreshToken,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE, refresh.refreshToken, {
    ...refreshCookieOptions(secure),
    expires: refresh.expiresAt,
  });
  response.cookie(SESSION_HINT_COOKIE, '1', {
    ...hintCookieOptions(secure),
    expires: refresh.expiresAt,
  });
}

export function clearAuthCookies(response: Response, secure: boolean): void {
  response.clearCookie(REFRESH_COOKIE, refreshCookieOptions(secure));
  response.clearCookie(SESSION_HINT_COOKIE, hintCookieOptions(secure));
}

export function readRefreshCookie(request: Request): string | undefined {
  const value: unknown = request.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * CSRF defence for the cookie-authenticated endpoints. A cross-site page cannot attach a custom
 * header without a CORS preflight, which this API never approves.
 */
export function assertFirstPartyClient(request: Request): void {
  if (!request.get(CLIENT_HEADER)) {
    throw new ForbiddenError('This endpoint is only available to the Solmira web client');
  }
}

export function clientMetadata(request: Request) {
  return { userAgent: request.get('user-agent') ?? null, ipAddress: request.ip ?? null };
}
