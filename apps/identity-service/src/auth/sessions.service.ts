import { Inject, Injectable } from '@nestjs/common';
import type { IdentityEventPayloads, SessionSummary } from '@solmira/contracts';
import { REVOCATION_STORE, type RevocationStore } from '@solmira/service-kit';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { IdentityConfig } from '../config.js';
import { Database, type IdentityTransaction } from '../database/database.module.js';
import { refreshTokens, sessions, users } from '../database/schema.js';
import { IDENTITY_CONFIG } from '../identity.tokens.js';
import { recordEvent } from '../outbox/outbox.js';
import { generateOpaqueToken, hashToken } from './secrets.js';

export type RevokeReason = IdentityEventPayloads['session.revoked']['reason'];

export interface ClientMetadata {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

export interface IssuedRefreshToken {
  readonly sessionId: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export interface SessionState {
  readonly id: string;
  readonly userId: string;
  readonly activeOrganizationId: string | null;
}

export type RotationResult =
  | {
      readonly status: 'rotated';
      readonly session: SessionState;
      readonly issued: IssuedRefreshToken;
    }
  | { readonly status: 'reused'; readonly session: SessionState }
  | { readonly status: 'invalid' };

const MAX_USER_AGENT_LENGTH = 400;

/**
 * Sessions and refresh-token rotation. A session is a chain of refresh tokens; each refresh
 * consumes the presented token and issues its successor. Presenting an already-consumed token
 * means two parties hold the same token (theft), so the whole session is revoked.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    @Inject(REVOCATION_STORE) private readonly revocations: RevocationStore,
  ) {}

  async create(
    tx: IdentityTransaction,
    input: { userId: string; activeOrganizationId: string | null; client: ClientMetadata },
  ): Promise<IssuedRefreshToken> {
    const now = Date.now();
    const sessionId = uuidv7();
    const sessionExpiresAt = new Date(now + this.config.SESSION_MAX_AGE_SECONDS * 1000);
    await tx.insert(sessions).values({
      id: sessionId,
      userId: input.userId,
      activeOrganizationId: input.activeOrganizationId,
      userAgent: input.client.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      ipAddress: input.client.ipAddress,
      expiresAt: sessionExpiresAt,
    });
    return this.issueRefreshToken(tx, sessionId, sessionExpiresAt);
  }

  async rotate(presentedToken: string): Promise<RotationResult> {
    const result = await this.database.unscoped(async (tx): Promise<RotationResult> => {
      // Row locks serialise concurrent refreshes of the same token: the second caller waits,
      // then sees the token as used and is treated as a replay.
      const [row] = await tx
        .select({ token: refreshTokens, session: sessions, userStatus: users.status })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(refreshTokens.tokenHash, hashToken(presentedToken)))
        .for('update', { of: [refreshTokens, sessions] });

      if (!row || row.session.revokedAt) return { status: 'invalid' };
      const session: SessionState = {
        id: row.session.id,
        userId: row.session.userId,
        activeOrganizationId: row.session.activeOrganizationId,
      };

      if (row.token.usedAt || row.token.revokedAt) {
        await this.revokeInTransaction(tx, session, 'refresh_token_reuse');
        return { status: 'reused', session };
      }
      const now = new Date();
      if (row.token.expiresAt <= now || row.session.expiresAt <= now) return { status: 'invalid' };
      if (row.userStatus !== 'active') {
        await this.revokeInTransaction(tx, session, 'account_disabled');
        return { status: 'invalid' };
      }

      const issued = await this.issueRefreshToken(tx, session.id, row.session.expiresAt);
      await tx
        .update(refreshTokens)
        .set({ usedAt: now, replacedById: issued.tokenId })
        .where(eq(refreshTokens.id, row.token.id));
      await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
      return { status: 'rotated', session, issued };
    });

    // Denylist entries are written only after the revocation has committed.
    if (result.status === 'reused') await this.revocations.revokeSession(result.session.id);
    return result;
  }

  /** Finds the session a refresh token belongs to, whether or not the token was already used. */
  async findByRefreshToken(presentedToken: string): Promise<SessionState | null> {
    return this.database.unscoped(async (tx) => {
      const [row] = await tx
        .select({
          id: sessions.id,
          userId: sessions.userId,
          activeOrganizationId: sessions.activeOrganizationId,
        })
        .from(refreshTokens)
        .innerJoin(sessions, eq(sessions.id, refreshTokens.sessionId))
        .where(
          and(eq(refreshTokens.tokenHash, hashToken(presentedToken)), isNull(sessions.revokedAt)),
        );
      return row ?? null;
    });
  }

  async revoke(session: SessionState, reason: RevokeReason): Promise<void> {
    await this.database.unscoped((tx) => this.revokeInTransaction(tx, session, reason));
    await this.revocations.revokeSession(session.id);
  }

  async revokeAllForUser(
    tx: IdentityTransaction,
    userId: string,
    reason: RevokeReason,
  ): Promise<string[]> {
    const active = await tx
      .select({
        id: sessions.id,
        userId: sessions.userId,
        activeOrganizationId: sessions.activeOrganizationId,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    for (const session of active) await this.revokeInTransaction(tx, session, reason);
    return active.map((session) => session.id);
  }

  async denylist(sessionIds: readonly string[]): Promise<void> {
    await Promise.all(sessionIds.map((id) => this.revocations.revokeSession(id)));
  }

  async listActive(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    return this.database.unscoped(async (tx) => {
      const rows = await tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(sessions.lastSeenAt));
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        userAgent: row.userAgent,
        current: row.id === currentSessionId,
      }));
    });
  }

  /** Revokes one of the caller's own sessions. Another user's session id behaves as missing. */
  async revokeOwn(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.database.unscoped(async (tx) => {
      const [row] = await tx
        .select({
          id: sessions.id,
          userId: sessions.userId,
          activeOrganizationId: sessions.activeOrganizationId,
        })
        .from(sessions)
        .where(
          and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)),
        );
      return row;
    });
    if (!session) return false;
    await this.revoke(session, 'user_request');
    return true;
  }

  async setActiveOrganization(sessionId: string, organizationId: string | null): Promise<void> {
    await this.database.unscoped((tx) =>
      tx
        .update(sessions)
        .set({ activeOrganizationId: organizationId })
        .where(eq(sessions.id, sessionId)),
    );
  }

  private async issueRefreshToken(
    tx: IdentityTransaction,
    sessionId: string,
    sessionExpiresAt: Date,
  ): Promise<IssuedRefreshToken & { tokenId: string }> {
    const refreshToken = generateOpaqueToken();
    const idleExpiry = Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000;
    const expiresAt = new Date(Math.min(idleExpiry, sessionExpiresAt.getTime()));
    const tokenId = uuidv7();
    await tx.insert(refreshTokens).values({
      id: tokenId,
      sessionId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });
    return { sessionId, refreshToken, expiresAt, tokenId };
  }

  private async revokeInTransaction(
    tx: IdentityTransaction,
    session: SessionState,
    reason: RevokeReason,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: reason })
      .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.sessionId, session.id), isNull(refreshTokens.revokedAt)));
    await recordEvent(
      tx,
      'session.revoked',
      { userId: session.userId, sessionId: session.id, reason },
      { actorId: session.userId },
    );
  }
}
