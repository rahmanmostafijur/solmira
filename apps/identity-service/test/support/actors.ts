import { randomUUID } from 'node:crypto';
import {
  CLIENT_HEADER,
  REFRESH_COOKIE,
  type AuthSession,
  type Organization,
  type RoleKey,
} from '@solmira/contracts';
import type { Response } from 'supertest';
import type { TestApp } from './test-app.js';

export const PASSWORD = 'correct horse battery staple';

/** A signed-in person: their latest access token and refresh cookie. */
export interface Actor {
  readonly email: string;
  readonly password: string;
  readonly userId: string;
  accessToken: string;
  refreshCookie: string;
  session: AuthSession;
}

export const uniqueEmail = (label: string) => `${label}.${randomUUID().slice(0, 8)}@solmira.test`;

export const bearer = (actor: Actor) => ({ Authorization: `Bearer ${actor.accessToken}` });

/** Decodes (does not verify) a JWT payload, to inspect what the server issued. */
export function claimsOf(token: string): Record<string, unknown> & { sid: string; sub: string } {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
}

export function refreshCookieFrom(response: Response): string {
  const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const cookie = cookies.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
  const token = cookie?.split(';')[0];
  if (!token || token === `${REFRESH_COOKIE}=`)
    throw new Error('Response did not set a refresh cookie');
  return token;
}

function adopt(actor: Actor, response: Response): Actor {
  actor.session = response.body as AuthSession;
  actor.accessToken = actor.session.accessToken;
  if (response.headers['set-cookie']) actor.refreshCookie = refreshCookieFrom(response);
  return actor;
}

export async function register(t: TestApp, label: string, fullName = label): Promise<Actor> {
  const email = uniqueEmail(label);
  const response = await t
    .http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName })
    .expect(201);
  const session = response.body as AuthSession;
  return {
    email,
    password: PASSWORD,
    userId: session.user.id,
    accessToken: session.accessToken,
    refreshCookie: refreshCookieFrom(response),
    session,
  };
}

export function refresh(t: TestApp, cookie: string) {
  return t.http().post('/api/v1/auth/refresh').set('Cookie', cookie).set(CLIENT_HEADER, 'web');
}

export async function refreshActor(t: TestApp, actor: Actor): Promise<Actor> {
  return adopt(actor, await refresh(t, actor.refreshCookie).expect(200));
}

export async function switchTo(t: TestApp, actor: Actor, organizationId: string): Promise<Actor> {
  const response = await t
    .http()
    .post('/api/v1/auth/switch-organization')
    .set(bearer(actor))
    .send({ organizationId })
    .expect(200);
  return adopt(actor, response);
}

/** Registers a user, creates an organization and switches the user into it as OWNER. */
export async function ownerOfNewOrganization(t: TestApp, label: string, organizationName: string) {
  const owner = await register(t, label);
  const response = await t
    .http()
    .post('/api/v1/organizations')
    .set(bearer(owner))
    .send({ name: organizationName })
    .expect(201);
  const organization = response.body as Organization;
  await switchTo(t, owner, organization.id);
  return { owner, organization };
}

/** Full invitation flow: invite, register, accept via the emailed link, switch in. */
export async function joinAs(
  t: TestApp,
  inviter: Actor,
  organizationId: string,
  role: RoleKey,
  label: string,
): Promise<Actor> {
  const member = await register(t, label);
  await t
    .http()
    .post(`/api/v1/organizations/${organizationId}/invitations`)
    .set(bearer(inviter))
    .send({ email: member.email, role })
    .expect(201);
  const token = t.emails.tokenFor(member.email, '/accept-invitation');
  await t.http().post('/api/v1/invitations/accept').set(bearer(member)).send({ token }).expect(200);
  return switchTo(t, member, organizationId);
}

export async function memberIdOf(
  t: TestApp,
  organizationId: string,
  userId: string,
): Promise<string> {
  const { rows } = await t.db.query<{ id: string }>(
    'select id from organization_members where organization_id = $1 and user_id = $2',
    [organizationId, userId],
  );
  if (!rows[0]) throw new Error('membership not found');
  return rows[0].id;
}
