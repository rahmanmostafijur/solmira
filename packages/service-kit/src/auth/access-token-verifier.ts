import { accessTokenClaimsSchema, type AccessTokenClaims } from '@solmira/contracts';
import {
  createRemoteJWKSet,
  errors,
  importSPKI,
  jwtVerify,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';
import { TokenExpiredError, UnauthenticatedError } from '../errors/app-error.js';

/**
 * Where the verification key comes from. Services other than identity use the JWKS endpoint
 * identity publishes; identity itself (which issues the tokens) can use its own public key.
 */
export type VerificationKeySource =
  | { readonly publicKeyPem: string; readonly jwksUrl?: undefined }
  | { readonly jwksUrl: string; readonly publicKeyPem?: undefined };

export type AccessTokenVerifierOptions = VerificationKeySource & {
  readonly issuer: string;
  readonly audience: string;
};

export const ACCESS_TOKEN_ALGORITHM = 'EdDSA';
const CLOCK_TOLERANCE_SECONDS = 5;
/** Keys are cached; an unknown `kid` (key rotation) triggers a refetch, at most every 30s. */
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const JWKS_COOLDOWN_MS = 30 * 1000;
const JWKS_TIMEOUT_MS = 3_000;

/**
 * Verifies access tokens locally with the identity service's public key. No network call per
 * request (JWKS responses are cached), and a compromised downstream service cannot mint tokens
 * because it never holds the private key.
 */
export class AccessTokenVerifier {
  private readonly key: Promise<CryptoKey> | JWTVerifyGetKey;

  constructor(private readonly options: AccessTokenVerifierOptions) {
    this.key =
      options.jwksUrl !== undefined
        ? createRemoteJWKSet(new URL(options.jwksUrl), {
            cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
            cooldownDuration: JWKS_COOLDOWN_MS,
            timeoutDuration: JWKS_TIMEOUT_MS,
          })
        : importSPKI(options.publicKeyPem, ACCESS_TOKEN_ALGORITHM);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const verifyOptions = {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    };
    try {
      const { payload } =
        typeof this.key === 'function'
          ? await jwtVerify(token, this.key, verifyOptions)
          : await jwtVerify(token, await this.key, verifyOptions);
      const claims = accessTokenClaimsSchema.safeParse(payload);
      if (!claims.success) throw new UnauthenticatedError('Invalid access token');
      return claims.data;
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw new TokenExpiredError();
      if (error instanceof UnauthenticatedError) throw error;
      throw new UnauthenticatedError('Invalid access token');
    }
  }
}
