import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  bearer,
  refresh,
  refreshActor,
  refreshCookieFrom,
  register,
  type Actor,
} from './support/actors.js';
import { createTestApp, type TestApp } from './support/test-app.js';

const NEW_PASSWORD = 'an entirely different passphrase';

describe('own account: profile and password (real PostgreSQL + Redis)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ LOGIN_MAX_FAILURES: '3' });
  });

  afterAll(async () => {
    await t.close();
  });

  const login = (email: string, password: string) =>
    t.http().post('/api/v1/auth/login').send({ email, password });
  const updateProfile = (actor: Actor, body: unknown) =>
    t
      .http()
      .patch('/api/v1/me')
      .set(bearer(actor))
      .send(body as object);
  const changePassword = (actor: Actor, body: unknown) =>
    t
      .http()
      .post('/api/v1/me/password')
      .set(bearer(actor))
      .send(body as object);
  const eventsOf = async (userId: string, type: string) => {
    const { rows } = await t.db.query(
      `select actor_id, payload from outbox_events where type = $1 and payload->>'userId' = $2`,
      [type, userId],
    );
    return rows as { actor_id: string; payload: Record<string, unknown> }[];
  };

  describe('PATCH /me', () => {
    it('changes the name and answers like GET /me', async () => {
      const actor = await register(t, 'rename', 'Ana Lopez');

      const updated = await updateProfile(actor, { fullName: '  Ana López García ' }).expect(200);
      const me = await t.http().get('/api/v1/me').set(bearer(actor)).expect(200);

      expect(updated.body.user.fullName).toBe('Ana López García');
      expect(updated.body).toEqual(me.body);
    });

    it('records user.profile_updated with the field names only', async () => {
      const actor = await register(t, 'renameevent', 'Before Name');
      await updateProfile(actor, { fullName: 'After Name' }).expect(200);

      const events = await eventsOf(actor.userId, 'user.profile_updated');
      expect(events).toEqual([
        { actor_id: actor.userId, payload: { userId: actor.userId, fields: ['fullName'] } },
      ]);
    });

    it('validates the name with the registration bounds', async () => {
      const actor = await register(t, 'renamebad');
      for (const fullName of ['   ', 'x'.repeat(121), undefined]) {
        const response = await updateProfile(actor, { fullName }).expect(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details[0].path).toBe('fullName');
      }
    });

    it('never changes the email', async () => {
      const actor = await register(t, 'noemail');
      const response = await updateProfile(actor, {
        fullName: 'Still Me',
        email: 'taken.over@solmira.test',
      }).expect(200);

      expect(response.body.user.email).toBe(actor.email);
      await login(actor.email, PASSWORD).expect(200);
    });

    it('requires authentication', async () => {
      await t.http().patch('/api/v1/me').send({ fullName: 'Nobody' }).expect(401);
    });
  });

  describe('POST /me/password', () => {
    it('changes the password: the old one stops working and the new one signs in', async () => {
      const actor = await register(t, 'change');

      await changePassword(actor, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
        204,
      );

      await login(actor.email, PASSWORD).expect(401);
      await login(actor.email, NEW_PASSWORD).expect(200);
      const { rows } = await t.db.query('select password_hash from users where id = $1', [
        actor.userId,
      ]);
      expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    });

    it('signs out every other session and keeps the current one', async () => {
      const actor = await register(t, 'othersessions');
      const laptop = await login(actor.email, PASSWORD).expect(200);
      const laptopCookie = refreshCookieFrom(laptop);
      const laptopToken = laptop.body.accessToken as string;

      await changePassword(actor, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
        204,
      );

      // The other device: access token denylisted at once, refresh token dead.
      await t.http().get('/api/v1/me').set('Authorization', `Bearer ${laptopToken}`).expect(401);
      await refresh(t, laptopCookie).expect(401);
      // The device that made the change: still signed in, and can keep refreshing.
      await t.http().get('/api/v1/me').set(bearer(actor)).expect(200);
      await refreshActor(t, actor);
      await t.http().get('/api/v1/me').set(bearer(actor)).expect(200);

      const { rows } = await t.db.query(
        `select id, revoke_reason from sessions where user_id = $1 order by created_at`,
        [actor.userId],
      );
      expect(rows.map((row) => row.revoke_reason)).toEqual([null, 'password_changed']);
      const revoked = await eventsOf(actor.userId, 'session.revoked');
      expect(revoked.map((event) => event.payload)).toEqual([
        { userId: actor.userId, sessionId: rows[1].id, reason: 'password_changed' },
      ]);
    });

    it('records user.password_changed without any password or hash', async () => {
      const actor = await register(t, 'changeevent');
      await changePassword(actor, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }).expect(
        204,
      );

      const events = await eventsOf(actor.userId, 'user.password_changed');
      const { rows } = await t.db.query('select password_hash from users where id = $1', [
        actor.userId,
      ]);
      const { rows: sessions } = await t.db.query('select id from sessions where user_id = $1', [
        actor.userId,
      ]);
      expect(events).toEqual([
        { actor_id: actor.userId, payload: { userId: actor.userId, sessionId: sessions[0].id } },
      ]);
      const serialized = JSON.stringify(events);
      for (const secret of [PASSWORD, NEW_PASSWORD, rows[0].password_hash, 'argon2'])
        expect(serialized).not.toContain(secret);
    });

    it('refuses a wrong current password with a stable code and changes nothing', async () => {
      const actor = await register(t, 'wrongcurrent');
      const other = await login(actor.email, PASSWORD).expect(200);

      const response = await changePassword(actor, {
        currentPassword: 'not the current password',
        newPassword: NEW_PASSWORD,
      }).expect(400);

      expect(response.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(response.body.error.details).toEqual([
        { path: 'currentPassword', message: expect.any(String) },
      ]);
      await login(actor.email, PASSWORD).expect(200);
      await refresh(t, refreshCookieFrom(other)).expect(200);
      expect(await eventsOf(actor.userId, 'user.password_changed')).toEqual([]);
    });

    it('applies the registration password policy to the new password', async () => {
      const actor = await register(t, 'policy');
      for (const newPassword of ['too short', 'x'.repeat(129), PASSWORD]) {
        const response = await changePassword(actor, {
          currentPassword: PASSWORD,
          newPassword,
        }).expect(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
        expect(response.body.error.details.map((d: { path: string }) => d.path)).toEqual([
          'newPassword',
        ]);
      }
      await login(actor.email, PASSWORD).expect(200);
    });

    it('shares the login lockout, so a stolen access token gives no extra guesses', async () => {
      const actor = await register(t, 'changelock');
      for (let attempt = 0; attempt < 3; attempt += 1)
        await changePassword(actor, {
          currentPassword: `guess-${attempt}-xxxxxx`,
          newPassword: NEW_PASSWORD,
        }).expect(400);

      const locked = await changePassword(actor, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(429);
      expect(locked.body.error.code).toBe('RATE_LIMITED');
      expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
      await login(actor.email, PASSWORD).expect(429);
    });

    it('refuses a disabled account even with the right password', async () => {
      const actor = await register(t, 'changedisabled');
      await t.db.query(`update users set status = 'disabled', disabled_at = now() where id = $1`, [
        actor.userId,
      ]);

      const response = await changePassword(actor, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(403);
      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
    });

    it('requires authentication', async () => {
      await t
        .http()
        .post('/api/v1/me/password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });
  });
});
