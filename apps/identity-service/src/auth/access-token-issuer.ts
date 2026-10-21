import { Inject, Injectable } from '@nestjs/common';
import { ACCESS_TOKEN_ALGORITHM } from '@solmira/service-kit';
import { SignJWT, exportJWK, importPKCS8, importSPKI, type CryptoKey, type JWK } from 'jose';
import type { IdentityConfig } from '../config.js';
import { IDENTITY_CONFIG } from '../identity.tokens.js';
import type { OrganizationAccess } from './access-context.service.js';

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** The only place in the platform that holds the signing key. */
@Injectable()
export class AccessTokenIssuer {
  private readonly signingKey: Promise<CryptoKey>;
  private readonly publicJwk: Promise<JWK>;
  private readonly previousJwks: Promise<JWK[]>;

  constructor(@Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig) {
    this.signingKey = importPKCS8(config.JWT_PRIVATE_KEY, ACCESS_TOKEN_ALGORITHM);
    this.publicJwk = importSPKI(config.JWT_PUBLIC_KEY, ACCESS_TOKEN_ALGORITHM, {
      extractable: true,
    }).then((key) => exportJWK(key));
    // Earlier keys stay published so tokens signed with them verify until they expire. A key that
    // cannot be read is a configuration error found at start, not on the first sign-in.
    this.previousJwks = Promise.all(
      config.JWT_PREVIOUS_PUBLIC_KEYS.map(async ({ kid, publicKey }) => ({
        ...(await exportJWK(
          await importSPKI(publicKey, ACCESS_TOKEN_ALGORITHM, { extractable: true }),
        )),
        kid,
        alg: ACCESS_TOKEN_ALGORITHM,
        use: 'sig',
      })),
    );
    this.previousJwks.catch(() => undefined);
  }

  async issue(input: {
    userId: string;
    sessionId: string;
    access: OrganizationAccess | null;
  }): Promise<IssuedAccessToken> {
    const issuedAtMs = Date.now();
    const issuedAt = Math.floor(issuedAtMs / 1000);
    const expiresAt = issuedAt + this.config.ACCESS_TOKEN_TTL_SECONDS;
    const organizationClaims = input.access
      ? {
          org: input.access.organization.id,
          role: input.access.role,
          perms: [...input.access.permissions],
        }
      : {};

    const token = await new SignJWT({
      sid: input.sessionId,
      iat_ms: issuedAtMs,
      ...organizationClaims,
    })
      .setProtectedHeader({
        alg: ACCESS_TOKEN_ALGORITHM,
        kid: this.config.JWT_KEY_ID,
        typ: 'at+jwt',
      })
      .setSubject(input.userId)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(await this.signingKey);

    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  /** Published so other services (and key rotation) can discover the verification key. */
  async jwks(): Promise<{ keys: JWK[] }> {
    const jwk = await this.publicJwk;
    return {
      keys: [
        { ...jwk, kid: this.config.JWT_KEY_ID, alg: ACCESS_TOKEN_ALGORITHM, use: 'sig' },
        ...(await this.previousJwks),
      ],
    };
  }
}
