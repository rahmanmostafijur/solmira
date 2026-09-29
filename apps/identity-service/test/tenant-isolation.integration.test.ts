import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  claimsOf,
  joinAs,
  memberIdOf,
  ownerOfNewOrganization,
  switchTo,
  uniqueEmail,
  type Actor,
} from './support/actors.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/**
 * HTTP-level proof that one organization cannot reach another's data, using real users and
 * real tokens. Organization A: Alice (owner) and Sam (staff). Organization B: Bob (owner) and
 * Bea (staff), plus a pending invitation. Mo belongs to both.
 */
describe('tenant isolation through the API', () => {
  let t: TestApp;
  let orgA: string;
  let orgB: string;
  let alice: Actor;
  let bob: Actor;
  let bea: Actor;
  let mo: Actor;
  let beaMemberId: string;
  let bInvitationId: string;
  let bInvitationEmail: string;

  const asAlice = () => bearer(alice);

  beforeAll(async () => {
    t = await createTestApp();
    ({
      owner: alice,
      organization: { id: orgA },
    } = await ownerOfNewOrganization(t, 'alice', 'Northwind Traders'));
    ({
      owner: bob,
      organization: { id: orgB },
    } = await ownerOfNewOrganization(t, 'bob', 'Harbor Supply'));
    await joinAs(t, alice, orgA, 'STAFF', 'sam');
    bea = await joinAs(t, bob, orgB, 'STAFF', 'bea');
    beaMemberId = await memberIdOf(t, orgB, bea.userId);
    mo = await joinAs(t, alice, orgA, 'ADMIN', 'mo');
    await joinAs(t, bob, orgB, 'ADMIN', 'mo-b').catch(() => undefined);
    bInvitationEmail = uniqueEmail('b-invitee');
    const invitation = await t
      .http()
      .post(`/api/v1/organizations/${orgB}/invitations`)
      .set(bearer(bob))
      .send({ email: bInvitationEmail, role: 'VIEWER' })
      .expect(201);
    bInvitationId = invitation.body.id;
  });

  afterAll(async () => {
    await t.close();
  });

  const bState = async () => {
    const { rows } = await t.db.query(
      `select o.name,
              (select count(*)::int from organization_members m where m.organization_id = o.id) as members,
              (select count(*)::int from invitations i where i.organization_id = o.id and i.revoked_at is null) as invitations
         from organizations o where o.id = $1`,
      [orgB],
    );
    return rows[0];
  };

  describe('Alice (owner of A) against organization B', () => {
    it('cannot read B', async () => {
      const response = await t
        .http()
        .get(`/api/v1/organizations/${orgB}`)
        .set(asAlice())
        .expect(404);
      expect(JSON.stringify(response.body)).not.toContain('Harbor');
      await t.http().get(`/api/v1/organizations/${orgB}/members`).set(asAlice()).expect(404);
      await t.http().get(`/api/v1/organizations/${orgB}/invitations`).set(asAlice()).expect(404);
    });

    it('cannot modify B', async () => {
      const before = await bState();
      await t
        .http()
        .patch(`/api/v1/organizations/${orgB}`)
        .set(asAlice())
        .send({ name: 'Hijacked Ltd' })
        .expect(404);
      await t
        .http()
        .patch(`/api/v1/organizations/${orgB}/members/${beaMemberId}`)
        .set(asAlice())
        .send({ role: 'VIEWER' })
        .expect(404);
      expect(await bState()).toEqual(before);
    });

    it('cannot delete in B', async () => {
      const before = await bState();
      await t
        .http()
        .delete(`/api/v1/organizations/${orgB}/members/${beaMemberId}`)
        .set(asAlice())
        .expect(404);
      await t
        .http()
        .delete(`/api/v1/organizations/${orgB}/invitations/${bInvitationId}`)
        .set(asAlice())
        .expect(404);
      expect(await bState()).toEqual(before);
    });

    it('cannot create data inside B', async () => {
      const before = await bState();
      await t
        .http()
        .post(`/api/v1/organizations/${orgB}/invitations`)
        .set(asAlice())
        .send({ email: uniqueEmail('planted'), role: 'ADMIN' })
        .expect(404);
      expect(await bState()).toEqual(before);
    });

    it("cannot reach B's rows by putting B's ids under A's own routes (IDOR)", async () => {
      const before = await bState();
      await t
        .http()
        .patch(`/api/v1/organizations/${orgA}/members/${beaMemberId}`)
        .set(asAlice())
        .send({ role: 'VIEWER' })
        .expect(404);
      await t
        .http()
        .delete(`/api/v1/organizations/${orgA}/members/${beaMemberId}`)
        .set(asAlice())
        .expect(404);
      await t
        .http()
        .delete(`/api/v1/organizations/${orgA}/invitations/${bInvitationId}`)
        .set(asAlice())
        .expect(404);
      expect(await bState()).toEqual(before);
    });

    it('gets the same 404 for a real B id as for a random one (no enumeration oracle)', async () => {
      const real = await t
        .http()
        .delete(`/api/v1/organizations/${orgA}/members/${beaMemberId}`)
        .set(asAlice());
      const random = await t
        .http()
        .delete(`/api/v1/organizations/${orgA}/members/0192f000-0000-7000-8000-000000000000`)
        .set(asAlice());
      expect(real.status).toBe(404);
      expect(random.status).toBe(404);
      expect(real.body.error.message).toBe(random.body.error.message);
    });

    it('cannot switch into B without a membership', async () => {
      await t
        .http()
        .post('/api/v1/auth/switch-organization')
        .set(asAlice())
        .send({ organizationId: orgB })
        .expect(404);
      expect(claimsOf(alice.accessToken).org).toBe(orgA);
    });

    it('cannot smuggle a tenant id through the request body', async () => {
      const response = await t
        .http()
        .patch(`/api/v1/organizations/${orgA}`)
        .set(asAlice())
        .send({ name: 'Northwind Traders Ltd', id: orgB, organizationId: orgB })
        .expect(200);

      expect(response.body.id).toBe(orgA);
      expect((await bState()).name).toBe('Harbor Supply');
    });

    it('cannot redeem an invitation addressed to someone in B', async () => {
      const token = t.emails.tokenFor(bInvitationEmail, '/accept-invitation');
      await t.http().post('/api/v1/invitations/accept').set(asAlice()).send({ token }).expect(403);
    });

    it('only ever lists her own organizations', async () => {
      const list = await t.http().get('/api/v1/organizations').set(asAlice()).expect(200);
      expect(list.body.map((m: { organization: { id: string } }) => m.organization.id)).toEqual([
        orgA,
      ]);
      const me = await t.http().get('/api/v1/me').set(asAlice()).expect(200);
      expect(me.body.memberships).toHaveLength(1);
    });

    it('rejects forged tokens that claim organization B', async () => {
      const [header, payload] = alice.accessToken.split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
          org: orgB,
          role: 'OWNER',
        }),
      ).toString('base64url');
      const signature = alice.accessToken.split('.')[2];

      await t
        .http()
        .get(`/api/v1/organizations/${orgB}`)
        .set('Authorization', `Bearer ${header}.${forgedPayload}.${signature}`)
        .expect(401);
    });
  });

  describe('legitimate work keeps working', () => {
    it('Alice can read, update and manage organization A', async () => {
      await t.http().get(`/api/v1/organizations/${orgA}`).set(asAlice()).expect(200);
      const members = await t
        .http()
        .get(`/api/v1/organizations/${orgA}/members`)
        .set(asAlice())
        .expect(200);
      expect(members.body.every((m: { email: string }) => !m.email.startsWith('bea'))).toBe(true);
      await t
        .http()
        .post(`/api/v1/organizations/${orgA}/invitations`)
        .set(asAlice())
        .send({ email: uniqueEmail('a-hire'), role: 'STAFF' })
        .expect(201);
    });

    it('Bob is equally isolated from A', async () => {
      await t.http().get(`/api/v1/organizations/${orgA}/members`).set(bearer(bob)).expect(404);
      await t.http().get(`/api/v1/organizations/${orgB}/members`).set(bearer(bob)).expect(200);
    });
  });

  describe('a user who belongs to both organizations', () => {
    it('acts only in the organization of the current token, and switching is verified server-side', async () => {
      // Mo was invited to B too; accept and verify both memberships exist.
      const bEmailInvite = await t
        .http()
        .post(`/api/v1/organizations/${orgB}/invitations`)
        .set(bearer(bob))
        .send({ email: mo.email, role: 'VIEWER' });
      if (bEmailInvite.status === 201) {
        const token = t.emails.tokenFor(mo.email, '/accept-invitation');
        await t
          .http()
          .post('/api/v1/invitations/accept')
          .set(bearer(mo))
          .send({ token })
          .expect(200);
      }

      await switchTo(t, mo, orgA);
      await t.http().get(`/api/v1/organizations/${orgA}/members`).set(bearer(mo)).expect(200);
      await t.http().get(`/api/v1/organizations/${orgB}`).set(bearer(mo)).expect(404);

      await switchTo(t, mo, orgB);
      expect(claimsOf(mo.accessToken)).toMatchObject({ org: orgB, role: 'VIEWER' });
      await t.http().get(`/api/v1/organizations/${orgB}`).set(bearer(mo)).expect(200);
      // Admin in A, but only a viewer in B: the B token carries B's permissions.
      await t.http().get(`/api/v1/organizations/${orgB}/members`).set(bearer(mo)).expect(403);
      await t.http().get(`/api/v1/organizations/${orgA}`).set(bearer(mo)).expect(404);
    });
  });
});
