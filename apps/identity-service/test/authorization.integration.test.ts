import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  claimsOf,
  joinAs,
  memberIdOf,
  ownerOfNewOrganization,
  refreshActor,
  register,
  switchTo,
  uniqueEmail,
  type Actor,
} from './support/actors.js';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('role- and permission-based authorization', () => {
  let t: TestApp;
  let orgId: string;
  let owner: Actor;
  let admin: Actor;
  let manager: Actor;
  let staff: Actor;
  let viewer: Actor;

  const members = (actor: Actor) =>
    t.http().get(`/api/v1/organizations/${orgId}/members`).set(bearer(actor));
  const invite = (actor: Actor, role: string) =>
    t
      .http()
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set(bearer(actor))
      .send({ email: uniqueEmail('invitee'), role });
  const changeMember = (actor: Actor, memberId: string, body: object) =>
    t
      .http()
      .patch(`/api/v1/organizations/${orgId}/members/${memberId}`)
      .set(bearer(actor))
      .send(body);

  beforeAll(async () => {
    t = await createTestApp();
    ({
      owner,
      organization: { id: orgId },
    } = await ownerOfNewOrganization(t, 'olivia', 'Cascade Distribution'));
    admin = await joinAs(t, owner, orgId, 'ADMIN', 'adam');
    manager = await joinAs(t, owner, orgId, 'MANAGER', 'mia');
    staff = await joinAs(t, owner, orgId, 'STAFF', 'sam');
    viewer = await joinAs(t, owner, orgId, 'VIEWER', 'vic');
  });

  afterAll(async () => {
    await t.close();
  });

  it('puts the role and its permissions in the token, derived from the database', () => {
    expect(claimsOf(viewer.accessToken)).toMatchObject({ org: orgId, role: 'VIEWER' });
    expect(claimsOf(viewer.accessToken).perms).not.toContain('users.read');
    expect(claimsOf(admin.accessToken).perms).toContain('roles.assign');
  });

  it('lets everyone read the organization, but only member managers list members', async () => {
    for (const actor of [owner, admin, manager, staff, viewer]) {
      await t.http().get(`/api/v1/organizations/${orgId}`).set(bearer(actor)).expect(200);
    }
    await members(manager).expect(200);
    await members(staff).expect(403);
    await members(viewer).expect(403);
  });

  it('only owners and admins can invite, and only into roles below their own', async () => {
    await invite(viewer, 'VIEWER').expect(403);
    await invite(staff, 'VIEWER').expect(403);
    await invite(manager, 'STAFF').expect(403);
    await invite(admin, 'STAFF').expect(201);
    await invite(admin, 'ADMIN').expect(403);
    await invite(admin, 'OWNER').expect(403);
    await invite(owner, 'ADMIN').expect(201);
  });

  it('only owners and admins can change organization settings', async () => {
    await t
      .http()
      .patch(`/api/v1/organizations/${orgId}`)
      .set(bearer(manager))
      .send({ timezone: 'Europe/Oslo' })
      .expect(403);
    const response = await t
      .http()
      .patch(`/api/v1/organizations/${orgId}`)
      .set(bearer(admin))
      .send({ timezone: 'Europe/Oslo', currency: 'nok' })
      .expect(200);
    expect(response.body).toMatchObject({ timezone: 'Europe/Oslo', currency: 'NOK' });
  });

  it('stops admins from managing owners and members cannot change themselves', async () => {
    const ownerMemberId = await memberIdOf(t, orgId, owner.userId);
    const adminMemberId = await memberIdOf(t, orgId, admin.userId);

    await changeMember(admin, ownerMemberId, { role: 'VIEWER' }).expect(403);
    await changeMember(admin, ownerMemberId, { status: 'suspended' }).expect(403);
    await changeMember(admin, adminMemberId, { role: 'OWNER' }).expect(403);
    await changeMember(owner, await memberIdOf(t, orgId, owner.userId), { role: 'ADMIN' }).expect(
      403,
    );
  });

  it('requires roles.assign to change roles, even for a manager who can see the member', async () => {
    const staffMemberId = await memberIdOf(t, orgId, staff.userId);
    await changeMember(manager, staffMemberId, { role: 'VIEWER' }).expect(403);
  });

  it('applies a role change immediately: old tokens stop working, refreshed ones carry the new role', async () => {
    const promoted = await joinAs(t, owner, orgId, 'STAFF', 'pat');
    const staleToken = promoted.accessToken;
    const memberId = await memberIdOf(t, orgId, promoted.userId);

    await changeMember(admin, memberId, { role: 'MANAGER' }).expect(200);

    await t.http().get('/api/v1/me').set('Authorization', `Bearer ${staleToken}`).expect(401);
    await refreshActor(t, promoted);
    expect(claimsOf(promoted.accessToken).role).toBe('MANAGER');
    await members(promoted).expect(200);
  });

  it('suspension removes access to the organization but not to the account', async () => {
    const suspended = await joinAs(t, owner, orgId, 'STAFF', 'sus');
    await changeMember(owner, await memberIdOf(t, orgId, suspended.userId), {
      status: 'suspended',
    }).expect(200);

    await t.http().get(`/api/v1/organizations/${orgId}`).set(bearer(suspended)).expect(401);
    await refreshActor(t, suspended);
    expect(suspended.session.activeOrganization).toBeNull();
    await t
      .http()
      .post('/api/v1/auth/switch-organization')
      .set(bearer(suspended))
      .send({ organizationId: orgId })
      .expect(404);
    await t.http().get('/api/v1/me').set(bearer(suspended)).expect(200);
  });

  it('only users.delete may remove members, and removal is effective at once', async () => {
    const leaving = await joinAs(t, owner, orgId, 'VIEWER', 'leo');
    const memberId = await memberIdOf(t, orgId, leaving.userId);

    await t
      .http()
      .delete(`/api/v1/organizations/${orgId}/members/${memberId}`)
      .set(bearer(manager))
      .expect(403);
    await t
      .http()
      .delete(`/api/v1/organizations/${orgId}/members/${memberId}`)
      .set(bearer(admin))
      .expect(204);
    await t.http().get(`/api/v1/organizations/${orgId}`).set(bearer(leaving)).expect(401);
  });

  it('requires an organization context for tenant routes', async () => {
    const loner = await register(t, 'loner');
    const response = await t
      .http()
      .get(`/api/v1/organizations/${orgId}/members`)
      .set(bearer(loner))
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  describe('invitations', () => {
    it('can only be accepted by the invited email address', async () => {
      const invitedEmail = uniqueEmail('intended');
      await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email: invitedEmail, role: 'VIEWER' })
        .expect(201);
      const token = t.emails.tokenFor(invitedEmail, '/accept-invitation');
      const interceptor = await register(t, 'interceptor');

      await t
        .http()
        .post('/api/v1/invitations/accept')
        .set(bearer(interceptor))
        .send({ token })
        .expect(403);
      await t
        .http()
        .post('/api/v1/auth/switch-organization')
        .set(bearer(interceptor))
        .send({ organizationId: orgId })
        .expect(404);
    });

    it('are single-use, expire, and can be revoked', async () => {
      const joiner = await register(t, 'joiner');
      const created = await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email: joiner.email, role: 'VIEWER' })
        .expect(201);
      const token = t.emails.tokenFor(joiner.email, '/accept-invitation');

      await t
        .http()
        .post('/api/v1/invitations/accept')
        .set(bearer(joiner))
        .send({ token })
        .expect(200);
      await t
        .http()
        .post('/api/v1/invitations/accept')
        .set(bearer(joiner))
        .send({ token })
        .expect(400);
      await switchTo(t, joiner, orgId);

      const late = await register(t, 'late');
      await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email: late.email, role: 'VIEWER' })
        .expect(201);
      await t.db.query(
        `update invitations set expires_at = now() - interval '1 minute' where email = $1`,
        [late.email],
      );
      await t
        .http()
        .post('/api/v1/invitations/accept')
        .set(bearer(late))
        .send({ token: t.emails.tokenFor(late.email, '/accept-invitation') })
        .expect(400);

      expect(created.body.id).toBeDefined();
      const revocable = await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email: uniqueEmail('revoked'), role: 'VIEWER' })
        .expect(201);
      await t
        .http()
        .delete(`/api/v1/organizations/${orgId}/invitations/${revocable.body.id}`)
        .set(bearer(owner))
        .expect(204);
      await t
        .http()
        .delete(`/api/v1/organizations/${orgId}/invitations/${revocable.body.id}`)
        .set(bearer(owner))
        .expect(404);
    });

    it('rejects duplicate pending invitations and existing members', async () => {
      const email = uniqueEmail('twice');
      await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email, role: 'VIEWER' })
        .expect(201);
      await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email, role: 'VIEWER' })
        .expect(409);
      await t
        .http()
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .set(bearer(owner))
        .send({ email: staff.email, role: 'VIEWER' })
        .expect(409);
    });
  });
});
