import { Inject, Injectable } from '@nestjs/common';
import type { AuthSession, LoginRequest, RegisterRequest } from '@solmira/contracts';
import {
  AccountDisabledError,
  AttemptCounter,
  ConflictError,
  InvalidCredentialsError,
  NotFoundError,
  RateLimitedError,
  REDIS,
  UnauthenticatedError,
  type AuthContext,
} from '@solmira/service-kit';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import type { IdentityConfig } from '../config.js';
import { Database } from '../database/database.module.js';
import { isUniqueViolation } from '../database/errors.js';
import { users } from '../database/schema.js';
import { IDENTITY_CONFIG } from '../identity.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import { AccessContextService, type OrganizationAccess } from './access-context.service.js';
import { AccessTokenIssuer } from './access-token-issuer.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { PasswordHasher } from './password-hasher.js';
import { hashToken } from './secrets.js';
import {
  SessionsService,
  type ClientMetadata,
  type IssuedRefreshToken,
} from './sessions.service.js';

export interface AuthResult {
  readonly session: AuthSession;
  readonly refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthService {
  private readonly loginFailures: AttemptCounter;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(AccessContextService) private readonly access: AccessContextService,
    @Inject(AccessTokenIssuer) private readonly tokens: AccessTokenIssuer,
    @Inject(AccountRecoveryService) private readonly recovery: AccountRecoveryService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    @Inject(REDIS) redis: Redis,
  ) {
    this.loginFailures = new AttemptCounter(
      redis,
      'auth:login-failures',
      config.LOGIN_LOCKOUT_SECONDS,
    );
  }

  async register(input: RegisterRequest, client: ClientMetadata): Promise<AuthResult> {
    const passwordHash = await this.hasher.hash(input.password);
    const userId = uuidv7();
    const { refresh, verificationToken } = await this.database.unscoped(async (tx) => {
      try {
        await tx
          .insert(users)
          .values({ id: userId, email: input.email, passwordHash, fullName: input.fullName });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ConflictError('An account with this email already exists');
        throw error;
      }
      const issued = await this.sessions.create(tx, { userId, activeOrganizationId: null, client });
      const token = await this.recovery.createEmailToken(tx, userId, 'verify_email');
      await recordEvent(tx, 'user.registered', { userId }, { actorId: userId });
      return { refresh: issued, verificationToken: token };
    });
    await this.recovery.sendVerificationEmail(input.email, verificationToken);
    return { session: await this.buildSession(userId, refresh.sessionId, null), refresh };
  }

  async login(input: LoginRequest, client: ClientMetadata): Promise<AuthResult> {
    // Keyed by a hash so raw emails never land in Redis.
    const throttleKey = `email:${hashToken(input.email)}`;
    const throttle = await this.loginFailures.status(throttleKey);
    if (throttle.attempts >= this.config.LOGIN_MAX_FAILURES) {
      throw new RateLimitedError(throttle.retryAfterSeconds);
    }

    const [user] = await this.database.unscoped((tx) =>
      tx.select().from(users).where(eq(users.email, input.email)),
    );
    const passwordMatches = user
      ? await this.hasher.verify(user.passwordHash, input.password)
      : await this.hasher.verifyAgainstDummy(input.password);
    if (!user || !passwordMatches) {
      await this.loginFailures.record(throttleKey);
      throw new InvalidCredentialsError();
    }
    // Checked only after the password, so the disabled state is revealed only to the owner.
    if (user.status !== 'active') throw new AccountDisabledError();
    await this.loginFailures.reset(throttleKey);

    const organizationId = await this.access.defaultOrganizationId(user.id);
    const refresh = await this.database.unscoped(async (tx) => {
      const issued = await this.sessions.create(tx, {
        userId: user.id,
        activeOrganizationId: organizationId,
        client,
      });
      await recordEvent(
        tx,
        'user.logged_in',
        { userId: user.id, sessionId: issued.sessionId },
        { actorId: user.id },
      );
      return issued;
    });
    const access = organizationId ? await this.access.resolve(user.id, organizationId) : null;
    return { session: await this.buildSession(user.id, refresh.sessionId, access), refresh };
  }

  async refresh(presentedToken: string): Promise<AuthResult> {
    const rotation = await this.sessions.rotate(presentedToken);
    if (rotation.status !== 'rotated')
      throw new UnauthenticatedError('Your session has ended, sign in again');

    const { session, issued } = rotation;
    let access: OrganizationAccess | null = null;
    if (session.activeOrganizationId) {
      // Membership is re-checked on every refresh: a removed or suspended member loses the
      // organization within one access-token lifetime even without a denylist entry.
      access = await this.access.resolve(session.userId, session.activeOrganizationId);
      if (!access) await this.sessions.setActiveOrganization(session.id, null);
    }
    return {
      session: await this.buildSession(session.userId, session.id, access),
      refresh: issued,
    };
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    const session = await this.sessions.findByRefreshToken(presentedToken);
    if (!session) return;
    await this.sessions.revoke(session, 'logout');
    await this.database.unscoped((tx) =>
      recordEvent(
        tx,
        'user.logged_out',
        { userId: session.userId, sessionId: session.id },
        { actorId: session.userId },
      ),
    );
  }

  /**
   * The organization id comes from the client, so it is only a request: the new token is issued
   * only if the database confirms an active membership. Otherwise the organization "does not exist".
   */
  async switchOrganization(auth: AuthContext, organizationId: string): Promise<AuthSession> {
    const access = await this.access.resolve(auth.userId, organizationId);
    if (!access) throw new NotFoundError('Organization not found');
    await this.sessions.setActiveOrganization(auth.sessionId, organizationId);
    return this.buildSession(auth.userId, auth.sessionId, access);
  }

  async buildSession(
    userId: string,
    sessionId: string,
    access: OrganizationAccess | null,
  ): Promise<AuthSession> {
    const [user] = await this.database.unscoped((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    if (!user) throw new UnauthenticatedError();
    const accessToken = await this.tokens.issue({ userId, sessionId, access });
    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        emailVerified: user.emailVerifiedAt !== null,
      },
      activeOrganization: access
        ? { ...access.organization, role: access.role, permissions: [...access.permissions] }
        : null,
    };
  }
}
