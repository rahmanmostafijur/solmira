import { accessTokenClaimsSchema, type AccessTokenClaims } from '@solmira/contracts';
import { errors, importSPKI, jwtVerify, type CryptoKey } from 'jose';
import { TokenExpiredError, UnauthenticatedError } from '../errors/app-error.js';

export interface AccessTokenVerifierOptions {
  readonly publicKeyPem: string;
  readonly issuer: string;
  readonly audience: string;
}

export const ACCESS_TOKEN_ALGORITHM = 'EdDSA';
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Verifies access tokens locally with the identity service's public key. No network call per
 * request, and a compromised downstream service cannot mint tokens because it never holds the
 * private key.
 */
export class AccessTokenVerifier {
  private readonly key: Promise<CryptoKey>;

  constructor(private readonly options: AccessTokenVerifierOptions) {
    this.key = importSPKI(options.publicKeyPem, ACCESS_TOKEN_ALGORITHM);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, await this.key, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
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
