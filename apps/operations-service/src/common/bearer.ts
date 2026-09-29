import { parseBearerToken } from '@solmira/service-kit';
import type { Request } from 'express';

/** The caller's verified access token (the guard already checked it), for token relay. */
export function bearerTokenOf(request: Request): string {
  return parseBearerToken(request.headers.authorization);
}
