import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission, RoleKey } from '@solmira/contracts';
import { UnauthenticatedError } from '../errors/app-error.js';
import type { AuthContext, AuthenticatedRequest } from './auth-context.js';

export const IS_PUBLIC = 'auth:public';
export const REQUIRES_ORGANIZATION = 'auth:requires-organization';
export const REQUIRED_PERMISSIONS = 'auth:permissions';
export const REQUIRED_ROLES = 'auth:roles';

/**
 * Authentication is on by default for every route (the guard is global); `@Public()` is the
 * explicit, greppable opt-out. Forgetting a decorator therefore fails closed.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * The request must carry an organization context. If the route has an `:organizationId`
 * parameter it must equal the token's organization, otherwise the resource "does not exist" (404).
 */
export const RequireOrganization = () => SetMetadata(REQUIRES_ORGANIZATION, true);

/** All listed permissions are required. Implies `@RequireOrganization()`. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Rarely needed; prefer permissions. Implies `@RequireOrganization()`. */
export const RequireRole = (...roles: RoleKey[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new UnauthenticatedError();
    return request.auth;
  },
);
