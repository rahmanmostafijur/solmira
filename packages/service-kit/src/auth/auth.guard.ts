import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermissions, type Permission, type RoleKey } from '@solmira/contracts';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '../errors/app-error.js';
import { toAuthContext, type AuthContext, type AuthenticatedRequest } from './auth-context.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import {
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  REQUIRED_ROLES,
  REQUIRES_ORGANIZATION,
} from './decorators.js';
import { REVOCATION_STORE, type RevocationStore } from './revocation-store.js';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

interface GuardedRequest extends AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string>;
}

export function parseBearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? undefined : header;
  const match = value ? BEARER_PATTERN.exec(value) : null;
  if (!match?.[1]) throw new UnauthenticatedError('Missing or malformed Authorization header');
  return match[1];
}

/**
 * One global guard for authentication, tenant context and permissions, so the checks always run
 * in the same order and a route cannot accidentally skip one of them.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenVerifier) private readonly verifier: AccessTokenVerifier,
    @Inject(REVOCATION_STORE) private readonly revocations: RevocationStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const claims = await this.verifier.verify(parseBearerToken(request.headers.authorization));
    if (await this.revocations.isRevoked(claims)) {
      throw new UnauthenticatedError('This session is no longer valid');
    }
    const auth = toAuthContext(claims);
    request.auth = auth;

    const permissions =
      this.reflector.getAllAndMerge<Permission[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    const roles = this.reflector.getAllAndMerge<RoleKey[]>(REQUIRED_ROLES, targets) ?? [];
    const requiresOrganization =
      permissions.length > 0 ||
      roles.length > 0 ||
      this.reflector.getAllAndOverride<boolean>(REQUIRES_ORGANIZATION, targets) === true;

    if (requiresOrganization) this.assertOrganizationContext(auth, request.params);
    if (permissions.length > 0 && !hasPermissions(auth.permissions, permissions)) {
      throw new ForbiddenError();
    }
    if (roles.length > 0 && (!auth.role || !roles.includes(auth.role))) {
      throw new ForbiddenError();
    }
    return true;
  }

  private assertOrganizationContext(
    auth: AuthContext,
    params: Record<string, string> | undefined,
  ): void {
    if (!auth.organizationId) {
      throw new ForbiddenError('Select an organization to continue');
    }
    const routeOrganizationId = params?.organizationId;
    // Never confirm that another tenant's organization exists: a mismatch is indistinguishable
    // from a missing resource.
    if (routeOrganizationId !== undefined && routeOrganizationId !== auth.organizationId) {
      throw new NotFoundError();
    }
  }
}
