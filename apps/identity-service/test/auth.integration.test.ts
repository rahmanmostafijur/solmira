import { CLIENT_HEADER } from '@solmira/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  bearer,
  claimsOf,
  refresh,
  refreshActor,
  refreshCookieFrom,
  register,
  uniqueEmail,
} from './support/actors.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('authentication (real PostgreSQL + Redis)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ LOGIN_MAX_FAILURES: '3' });
  });

  afterAll(async () => {
    await t.close();
  });

  const login = (email: string, password: string) =>
    t.http().post('/api/v1/auth/login').send({ email, password });

  describe('registration', () => {
    it('creates the account, returns an access token and sets only cookies for the refresh token', async () => {
      const email = uniqueEmail('ana');
      const response = await t
        .http()
        .post('/api/v1/auth/register')
        .send({ email: email.toUpperCase(), password: PASSWORD, fullName: 'Ana Lopez' })
        .expect(201);

      expect(response.body.user).toMatchObject({
        email,
        fullName: 'Ana Lopez',
        emailVerified: false,
      });
      expect(response.body.accessToken).toMatch(/^ey/);
      expect(JSON.stringify(response.body)).not.toMatch(/refresh|password/i);

      const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
      const refreshCookie = cookies.find((c) => c.startsWith('solmira_refresh='))!;
      expect(refreshCookie).toMatch(/HttpOnly/);
      expect(refreshCookie).toMatch(/SameSite=Strict/);
      expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('stores an Argon2id hash, never the password', async () => {
      const actor = await register(t, 'hashcheck');
      const { rows } = await t.db.query('select password_hash from users where id = $1', [
        actor.userId,
      ]);

      expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
      expect(rows[0].password_hash).not.toContain(PASSWORD);
    });

    it('rejects a second account for the same email regardless of case', async () => {
      const actor = await register(t, 'dup');
      const response = await t
        .http()
        .post('/api/v1/auth/register')
        .send({ email: actor.email.toUpperCase(), password: PASSWORD, fullName: 'Copy' })
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('validates input with field-level errors', async () => {
      const response = await t
        .http()
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'short', fullName: '' })
        .expect(400);

      expect(response.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'email',
        'fullName',
        'password',
      ]);
    });

    it('records a user.registered event in the outbox', async () => {
      const actor = await register(t, 'outbox');
      const { rows } = await t.db.query(
        `select type from outbox_events where payload->>'userId' = $1 order by occurred_at`,
        [actor.userId],
      );
      expect(rows.map((row) => row.type)).toContain('user.registered');
    });
  });

  describe('login', () => {
    it('signs in with the right password and the token works', async () => {
      const actor = await register(t, 'login');
      const response = await login(actor.email, PASSWORD).expect(200);

      await t
        .http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .expect(200);
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const actor = await register(t, 'enum');
      const wrongPassword = await login(actor.email, 'wrong password entirely').expect(401);
      const unknownEmail = await login(uniqueEmail('nobody'), 'wrong password entirely').expect(
        401,
      );

      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it('locks the account after repeated failures, even for the correct password', async () => {
      const actor = await register(t, 'bruteforce');
      for (let attempt = 0; attempt < 3; attempt += 1)
        await login(actor.email, `guess-${attempt}-xxxxxx`).expect(401);

      const locked = await login(actor.email, PASSWORD).expect(429);
      expect(locked.body.error.code).toBe('RATE_LIMITED');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('refuses disabled accounts and ends their existing sessions on refresh', async () => {
      const actor = await register(t, 'disabled');
      await t.db.query(`update users set status = 'disabled', disabled_at = now() where id = $1`, [
        actor.userId,
      ]);

      const response = await login(actor.email, PASSWORD).expect(403);
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
      await refresh(t, actor.refreshCookie).expect(401);
      const { rows } = await t.db.query('select revoke_reason from sessions where user_id = $1', [
        actor.userId,
      ]);
      expect(rows[0].revoke_reason).toBe('account_disabled');
    });
  });

  describe('access tokens', () => {
    it.each([
      ['no header', undefined],
      ['wrong scheme', 'Basic YWxhZGRpbjpvcGVuc2VzYW1l'],
      ['garbage', 'Bearer ...'],
      ['a tampered token', 'tamper'],
    ])('rejects requests with %s', async (_label, header) => {
      const actor = await register(t, 'hdr');
      const value = header === 'tamper' ? `Bearer ${actor.accessToken.slice(0, -4)}AAAA` : header;
      const call = t.http().get('/api/v1/me');
      await (value ? call.set('Authorization', value) : call).expect(401);
    });

    it('reports expired access tokens as TOKEN_EXPIRED', async () => {
      const actor = await register(t, 'expired');
      const now = Math.floor(Date.now() / 1000);
      const expired = await t.signAccessToken(
        { sub: actor.userId, sid: claimsOf(actor.accessToken).sid },
        { iat: now - 3600, exp: now - 60 },
      );

      const response = await t
        .http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      expect(response.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('refresh token rotation', () => {
    it('rotates: every refresh returns a new cookie and a new access token', async () => {
      const actor = await register(t, 'rotate');
      const before = actor.refreshCookie;
      const response = await refresh(t, before).expect(200);

      expect(refreshCookieFrom(response)).not.toBe(before);
      expect(response.body.accessToken).toMatch(/^ey/);
    });

    it('detects reuse of a rotated token and revokes the whole session', async () => {
      const actor = await register(t, 'reuse');
      const stolen = actor.refreshCookie;
      await refreshActor(t, actor); // legitimate client rotates
      const current = actor.refreshCookie;

      await refresh(t, stolen).expect(401); // replay by the attacker
      await refresh(t, current).expect(401); // the legitimate chain is now dead too
      await t.http().get('/api/v1/me').set(bearer(actor)).expect(401); // and so is its access token

      const { rows } = await t.db.query(
        `select s.revoke_reason, (select count(*) from outbox_events o
            where o.type = 'session.revoked' and o.payload->>'sessionId' = s.id::text)::int as events
           from sessions s where s.user_id = $1`,
        [actor.userId],
      );
      expect(rows[0]).toEqual({ revoke_reason: 'refresh_token_reuse', events: 1 });
    });

    it('rejects expired refresh tokens', async () => {
      const actor = await register(t, 'rtexpired');
      await t.db.query(
        `update refresh_tokens set expires_at = now() - interval '1 minute'
          where session_id in (select id from sessions where user_id = $1)`,
        [actor.userId],
      );

      await refresh(t, actor.refreshCookie).expect(401);
    });

    it('requires the first-party client header (CSRF defence) and a cookie', async () => {
      const actor = await register(t, 'csrf');
      await t.http().post('/api/v1/auth/refresh').set('Cookie', actor.refreshCookie).expect(403);
      await t.http().post('/api/v1/auth/refresh').set(CLIENT_HEADER, 'web').expect(401);
    });

    it('stores refresh tokens only as hashes', async () => {
      const actor = await register(t, 'rthash');
      const raw = actor.refreshCookie.split('=')[1]!;
      const { rows } = await t.db.query(
        `select token_hash from refresh_tokens where session_id in (select id from sessions where user_id = $1)`,
        [actor.userId],
      );
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].token_hash).not.toBe(raw);
    });
  });

  describe('logout and sessions', () => {
    it('logout ends the session: refresh and the existing access token stop working', async () => {
      const actor = await register(t, 'logout');
      await t
        .http()
        .post('/api/v1/auth/logout')
        .set('Cookie', actor.refreshCookie)
        .set(CLIENT_HEADER, 'web')
        .expect(204);

      await refresh(t, actor.refreshCookie).expect(401);
      await t.http().get('/api/v1/me').set(bearer(actor)).expect(401);
    });

    it('logout is idempotent', async () => {
      await t.http().post('/api/v1/auth/logout').set(CLIENT_HEADER, 'web').expect(204);
    });

    it('lists sessions and can sign out another device', async () => {
      const actor = await register(t, 'devices');
      const laptop = await login(actor.email, PASSWORD).expect(200);
      const laptopCookie = refreshCookieFrom(laptop);

      const sessions = await t.http().get('/api/v1/auth/sessions').set(bearer(actor)).expect(200);
      expect(sessions.body).toHaveLength(2);
      const other = sessions.body.find((s: { current: boolean }) => !s.current);

      await t.http().delete(`/api/v1/auth/sessions/${other.id}`).set(bearer(actor)).expect(204);
      await refresh(t, laptopCookie).expect(401);
      await t
        .http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${laptop.body.accessToken}`)
        .expect(401);
    });

    it("cannot revoke someone else's session", async () => {
      const alice = await register(t, 'alice');
      const mallory = await register(t, 'mallory');
      const { rows } = await t.db.query('select id from sessions where user_id = $1', [
        alice.userId,
      ]);

      await t.http().delete(`/api/v1/auth/sessions/${rows[0].id}`).set(bearer(mallory)).expect(404);
      await refresh(t, alice.refreshCookie).expect(200);
    });
  });

  describe('password reset and email verification', () => {
    it('never reveals whether an email is registered', async () => {
      const sent = t.emails.messages.length;
      await t
        .http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: uniqueEmail('ghost') })
        .expect(202);
      expect(t.emails.messages.length).toBe(sent);
    });

    it('resets the password with a single-use link and ends every session', async () => {
      const actor = await register(t, 'reset');
      await t.http().post('/api/v1/auth/forgot-password').send({ email: actor.email }).expect(202);
      const token = t.emails.tokenFor(actor.email, '/reset-password');
      const newPassword = 'a completely new passphrase';

      await t
        .http()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(204);
      await t
        .http()
        .post('/api/v1/auth/reset-password')
        .send({ token, password: newPassword })
        .expect(400);

      await login(actor.email, PASSWORD).expect(401);
      await login(actor.email, newPassword).expect(200);
      await refresh(t, actor.refreshCookie).expect(401);
      await t.http().get('/api/v1/me').set(bearer(actor)).expect(401);
    });

    it('verifies the email address with the link sent at registration', async () => {
      const actor = await register(t, 'verify');
      const token = t.emails.tokenFor(actor.email, '/verify-email');

      await t.http().post('/api/v1/auth/verify-email').send({ token }).expect(204);
      await t.http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
      const me = await t.http().get('/api/v1/me').set(bearer(actor)).expect(200);
      expect(me.body.user.emailVerified).toBe(true);
    });
  });
});
