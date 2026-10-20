import {
  SetMetadata,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiKeyScope } from '@solmira/contracts';
import { ForbiddenError, UnauthenticatedError } from '@solmira/service-kit';
import type { Request } from 'express';
import { ApiKeyAuthenticator, type ApiKeyPrincipal } from '../api-keys/api-key-authenticator.js';
import { ApiKeyRateLimiter } from './api-key-rate-limiter.js';

const REQUIRED_SCOPE = 'ingest:api-key-scope';

/** The scope an API key must hold to call the route. */
export const RequireApiKeyScope = (scope: ApiKeyScope) => SetMetadata(REQUIRED_SCOPE, scope);

type RequestWithKey = Request & { apiKey?: ApiKeyPrincipal };

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ApiKeyPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithKey>();
    if (!request.apiKey) throw new UnauthenticatedError();
    return request.apiKey;
  },
);

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Authenticates a request with an API key (ADR-0027, ADR-0030): resolves the key, checks the scope,
 * and applies the per-key rate limit. Routes using it are `@Public()` for the JWT guard.
 * Anything wrong with the credential is the same `401`, so responses do not tell a guess from a
 * revoked key.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ApiKeyAuthenticator) private readonly authenticator: ApiKeyAuthenticator,
    @Inject(ApiKeyRateLimiter) private readonly limiter: ApiKeyRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithKey>();
    const presented = BEARER.exec(request.headers.authorization ?? '')?.[1];
    const principal = presented ? await this.authenticator.authenticate(presented) : null;
    if (!principal) throw new UnauthenticatedError('A valid API key is required');

    const scope = this.reflector.get<ApiKeyScope | undefined>(REQUIRED_SCOPE, context.getHandler());
    if (scope && !principal.scopes.includes(scope))
      throw new ForbiddenError('This API key does not have the ' + scope + ' scope');

    await this.limiter.consume(principal.apiKeyId);
    request.apiKey = principal;
    return true;
  }
}
