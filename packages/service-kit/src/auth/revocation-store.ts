import type { AccessTokenClaims } from '@solmira/contracts';
import type { Redis } from 'ioredis';
import { ServiceUnavailableError } from '../errors/app-error.js';

export const REVOCATION_STORE = Symbol('REVOCATION_STORE');

/**
 * Access tokens are stateless, so revocation needs a small shared denylist. Entries only have to
 * outlive the longest-lived access token; after that, the token has expired anyway.
 */
export interface RevocationStore {
  /** Invalidate every access token of a session (logout, reuse detection, password reset). */
  revokeSession(sessionId: string): Promise<void>;
  /**
   * Invalidate a user's access tokens for one organization that were issued before now
   * (role change, suspension, removal). Tokens issued afterwards carry the new state.
   */
  revokeMembership(organizationId: string, userId: string): Promise<void>;
  isRevoked(claims: AccessTokenClaims): Promise<boolean>;
}

const sessionKey = (sessionId: string) => `auth:revoked:sid:${sessionId}`;
const membershipKey = (organizationId: string, userId: string) =>
  `auth:revoked:member:${organizationId}:${userId}`;

export class RedisRevocationStore implements RevocationStore {
  constructor(
    private readonly redis: Redis,
    private readonly accessTokenTtlSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.set(sessionKey(sessionId), '1', 'EX', this.markerTtl());
  }

  async revokeMembership(organizationId: string, userId: string): Promise<void> {
    await this.redis.set(
      membershipKey(organizationId, userId),
      String(this.now()),
      'EX',
      this.markerTtl(),
    );
  }

  /** Fails closed: if the denylist cannot be read, the request is refused rather than trusted. */
  async isRevoked(claims: AccessTokenClaims): Promise<boolean> {
    const keys = [sessionKey(claims.sid)];
    if (claims.org) keys.push(membershipKey(claims.org, claims.sub));

    let values: (string | null)[];
    try {
      values = await this.redis.mget(...keys);
    } catch {
      throw new ServiceUnavailableError('Authentication is temporarily unavailable');
    }

    if (values[0]) return true;
    const membershipChangedAt = values[1] ? Number(values[1]) : undefined;
    if (membershipChangedAt === undefined) return false;
    // Prefer the millisecond claim. Without it, fall back to the earliest instant of the `iat`
    // second: that errs towards rejecting, and a rejected client simply refreshes.
    const issuedAt = claims.iat_ms ?? claims.iat * 1000;
    return issuedAt <= membershipChangedAt;
  }

  private markerTtl(): number {
    return this.accessTokenTtlSeconds + 60;
  }
}
