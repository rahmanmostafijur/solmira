import { createHash, randomBytes } from 'node:crypto';

/** 256 bits from the CSPRNG, URL-safe: refresh tokens, reset links, invitation links. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Secrets are stored only as hashes, so a database leak does not hand out live tokens.
 * SHA-256 (not Argon2) is correct here: the input is 256 random bits, so brute force is
 * infeasible regardless of hash speed, and a deterministic hash allows an indexed lookup.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
