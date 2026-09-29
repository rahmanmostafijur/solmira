import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Permission, RoleKey } from '@solmira/contracts';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { ACCESS_TOKEN_ALGORITHM } from '../auth/access-token-verifier.js';

export interface TestTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId?: string;
  readonly role?: RoleKey;
  readonly permissions?: readonly Permission[];
}

export interface TestIssuer {
  readonly issuer: string;
  readonly audience: string;
  /** Served over real HTTP, so services under test use the same JWKS path as production. */
  readonly jwksUrl: string;
  sign(
    claims: TestTokenClaims,
    options?: { expiresInSeconds?: number; key?: 'trusted' | 'untrusted' },
  ): Promise<string>;
  close(): Promise<void>;
}

const KEY_ID = 'test-key';

/**
 * Stands in for identity-service when testing another service: it signs access tokens with a
 * throwaway Ed25519 key and publishes the public half as a JWKS document.
 */
export async function startTestIssuer(
  issuer = 'solmira-identity',
  audience = 'solmira-api',
): Promise<TestIssuer> {
  const trusted = await generateKeyPair(ACCESS_TOKEN_ALGORITHM, { extractable: true });
  const untrusted = await generateKeyPair(ACCESS_TOKEN_ALGORITHM, { extractable: true });
  const jwk = {
    ...(await exportJWK(trusted.publicKey)),
    kid: KEY_ID,
    alg: ACCESS_TOKEN_ALGORITHM,
    use: 'sig',
  };

  const server: Server = createServer((request, response) => {
    if (request.url === '/jwks.json') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const signWith = async (key: CryptoKey, claims: TestTokenClaims, expiresInSeconds: number) => {
    const issuedAtMs = Date.now();
    const issuedAt = Math.floor(issuedAtMs / 1000);
    return new SignJWT({
      sid: claims.sessionId,
      iat_ms: issuedAtMs,
      ...(claims.organizationId
        ? {
            org: claims.organizationId,
            role: claims.role ?? 'VIEWER',
            perms: [...(claims.permissions ?? [])],
          }
        : {}),
    })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, kid: KEY_ID })
      .setSubject(claims.userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + expiresInSeconds)
      .sign(key);
  };

  return {
    issuer,
    audience,
    jwksUrl: `http://127.0.0.1:${port}/jwks.json`,
    sign: (claims, options = {}) =>
      signWith(
        options.key === 'untrusted' ? untrusted.privateKey : trusted.privateKey,
        claims,
        options.expiresInSeconds ?? 300,
      ),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
