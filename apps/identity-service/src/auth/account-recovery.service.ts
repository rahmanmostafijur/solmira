import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, AttemptCounter, REDIS } from '@solmira/service-kit';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import type { IdentityConfig } from '../config.js';
import { Database, type IdentityTransaction } from '../database/database.module.js';
import { emailTokens, users } from '../database/schema.js';
import { EMAIL_SENDER, IDENTITY_CONFIG } from '../identity.tokens.js';
import type { EmailSender } from '../mail/email-sender.js';
import { recordEvent } from '../outbox/outbox.js';
import { PasswordHasher } from './password-hasher.js';
import { generateOpaqueToken, hashToken } from './secrets.js';
import { SessionsService } from './sessions.service.js';

type EmailTokenPurpose = 'verify_email' | 'reset_password';

const TOKEN_TTL_SECONDS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * 3600,
  reset_password: 30 * 60,
};
const RESET_REQUESTS_PER_HOUR = 3;

export class InvalidLinkError extends AppError {
  constructor() {
    super('BAD_REQUEST', 'This link is invalid or has expired', 400);
  }
}

/** Email verification and password reset, both built on single-use, hashed, expiring tokens. */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);
  private readonly resetRequests: AttemptCounter;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    @Inject(REDIS) redis: Redis,
  ) {
    this.resetRequests = new AttemptCounter(redis, 'auth:reset-requests', 3600);
  }

  /** Issues a new token and invalidates any earlier unused token for the same purpose. */
  async createEmailToken(
    tx: IdentityTransaction,
    userId: string,
    purpose: EmailTokenPurpose,
  ): Promise<string> {
    const now = new Date();
    await tx
      .update(emailTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailTokens.userId, userId),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
        ),
      );
    const token = generateOpaqueToken();
    await tx.insert(emailTokens).values({
      id: uuidv7(),
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_SECONDS[purpose] * 1000),
    });
    return token;
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    await this.deliver({
      to,
      subject: 'Confirm your email address',
      text: `Confirm your Solmira account:\n\n${this.link('/verify-email', token)}\n\nThe link expires in 24 hours.`,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.database.unscoped(async (tx) => {
      const userId = await this.consume(tx, token, 'verify_email');
      if (!userId) throw new InvalidLinkError();
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId));
      await recordEvent(tx, 'user.email_verified', { userId }, { actorId: userId });
    });
  }

  /**
   * Always succeeds from the caller's point of view, whether or not the account exists, so the
   * endpoint cannot be used to discover registered emails. Throttled per address.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const key = hashToken(email);
    if ((await this.resetRequests.record(key)) > RESET_REQUESTS_PER_HOUR) return;

    const pending = await this.database.unscoped(async (tx) => {
      const [user] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.email, email));
      if (!user || user.status !== 'active') return null;
      return this.createEmailToken(tx, user.id, 'reset_password');
    });
    if (!pending) return;
    await this.deliver({
      to: email,
      subject: 'Reset your password',
      text:
        `Someone asked to reset the password for your Solmira account.\n\n` +
        `${this.link('/reset-password', pending)}\n\n` +
        `The link expires in 30 minutes. If this was not you, ignore this email.`,
    });
  }

  /** Sets the new password and ends every existing session: a reset usually means compromise. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordHash = await this.hasher.hash(newPassword);
    const revoked = await this.database.unscoped(async (tx) => {
      const userId = await this.consume(tx, token, 'reset_password');
      if (!userId) throw new InvalidLinkError();
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
      const sessionIds = await this.sessions.revokeAllForUser(tx, userId, 'password_reset');
      await recordEvent(tx, 'user.password_reset', { userId }, { actorId: userId });
      return sessionIds;
    });
    await this.sessions.denylist(revoked);
  }

  private async consume(
    tx: IdentityTransaction,
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ id: emailTokens.id, userId: emailTokens.userId })
      .from(emailTokens)
      .where(
        and(
          eq(emailTokens.tokenHash, hashToken(token)),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .for('update');
    if (!row) return null;
    await tx.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, row.id));
    return row.userId;
  }

  private link(path: string, token: string): string {
    return `${this.config.APP_URL}${path}?token=${encodeURIComponent(token)}`;
  }

  /** Email is best-effort after the transaction commits; a mail outage must not fail sign-up. */
  private async deliver(message: { to: string; subject: string; text: string }): Promise<void> {
    try {
      await this.email.send(message);
    } catch (error) {
      this.logger.error({ err: error, subject: message.subject }, 'Failed to send email');
    }
  }
}
