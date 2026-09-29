import type { AccessTokenClaims, RoleKey } from '@solmira/contracts';

/** The verified identity of the caller, attached to the request by the auth guard. */
export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  /** Set only when the token was issued for an organization the user is an active member of. */
  readonly organizationId: string | null;
  readonly role: RoleKey | null;
  readonly permissions: readonly string[];
}

/** An AuthContext that is guaranteed to carry an organization (after `@RequireOrganization`). */
export interface TenantAuthContext extends AuthContext {
  readonly organizationId: string;
  readonly role: RoleKey;
}

export function toAuthContext(claims: AccessTokenClaims): AuthContext {
  return {
    userId: claims.sub,
    sessionId: claims.sid,
    organizationId: claims.org ?? null,
    role: claims.role ?? null,
    permissions: claims.perms ?? [],
  };
}

export interface AuthenticatedRequest {
  auth?: AuthContext;
}
