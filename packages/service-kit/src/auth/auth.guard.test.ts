import 'reflect-metadata';
import { Controller, Get, Module, Param } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AccessTokenClaims } from '@solmira/contracts';
import { SignJWT, exportSPKI, generateKeyPair, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_GUARD } from '@nestjs/core';
import { createServiceApp } from '../bootstrap.js';
import { PlatformModule } from '../platform.module.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import type { AuthContext } from './auth-context.js';
import { AuthGuard } from './auth.guard.js';
import {
  CurrentAuth,
  Public,
  RequireOrganization,
  RequirePermission,
  RequireRole,
} from './decorators.js';
import { REVOCATION_STORE, type RevocationStore } from './revocation-store.js';

const ISSUER = 'solmira-identity';
const AUDIENCE = 'solmira-api';
const USER = '0192a3b4-0000-7000-8000-000000000001';
const SESSION = '0192a3b4-0000-7000-8000-000000000002';
const ORG_A = '0192a3b4-0000-7000-8000-00000000000a';
const ORG_B = '0192a3b4-0000-7000-8000-00000000000b';

class InMemoryRevocations implements RevocationStore {
  revokedSessions = new Set<string>();
  async revokeSession(sessionId: string) {
    this.revokedSessions.add(sessionId);
  }
  async revokeMembership() {}
  async isRevoked(claims: AccessTokenClaims) {
    return this.revokedSessions.has(claims.sid);
  }
}

@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  open() {
    return { ok: true };
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return auth;
  }

  @RequireOrganization()
  @Get('organizations/:organizationId')
  organization(@Param('organizationId') id: string) {
    return { id };
  }

  @RequirePermission('users.create')
  @Get('invite')
  invite() {
    return { ok: true };
  }

  @RequireRole('OWNER')
  @Get('owner-only')
  ownerOnly() {
    return { ok: true };
  }
}

describe('AuthGuard', () => {
  let app: NestExpressApplication;
  let privateKey: CryptoKey;
  let foreignKey: CryptoKey;
  const revocations = new InMemoryRevocations();

  const sign = async (
    claims: Partial<AccessTokenClaims> & Record<string, unknown> = {},
    options: { key?: CryptoKey; expiresIn?: string; issuer?: string; audience?: string } = {},
  ) =>
    new SignJWT({ sid: SESSION, ...claims })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(USER)
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m')
      .sign(options.key ?? privateKey);

  const memberOfA = { org: ORG_A, role: 'STAFF' as const, perms: ['orders.read'] };

  beforeAll(async () => {
    const keys = await generateKeyPair('EdDSA');
    privateKey = keys.privateKey;
    foreignKey = (await generateKeyPair('EdDSA')).privateKey;
    const publicKeyPem = await exportSPKI(keys.publicKey);

    @Module({
      imports: [
        PlatformModule.forRoot({
          serviceName: 'probe',
          logging: { level: 'silent', pretty: false },
        }),
      ],
      controllers: [ProbeController],
      providers: [
        {
          provide: AccessTokenVerifier,
          useValue: new AccessTokenVerifier({ publicKeyPem, issuer: ISSUER, audience: AUDIENCE }),
        },
        { provide: REVOCATION_STORE, useValue: revocations },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    })
    class ProbeModule {}

    app = await createServiceApp(ProbeModule, { serviceName: 'probe', nodeEnv: 'test' });
    await app.init();
  });

  beforeEach(() => revocations.revokedSessions.clear());

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, token?: string) => {
    const call = request(app.getHttpServer()).get(`/api/v1/probe/${path}`);
    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  };

  it('lets public routes through without a token', async () => {
    await get('public').expect(200);
  });

  it('keeps health probes public so load balancers can reach them', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });

  it('protects every other route by default', async () => {
    const response = await get('me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a bearer without a token', 'Bearer '],
    ['a token that is not a JWT', 'Bearer not-a-jwt'],
    ['extra segments', 'Bearer a.b.c.d'],
    ['lowercase scheme with trailing junk', 'bearer a.b.c extra'],
  ])('rejects malformed Authorization headers: %s', async (_label, header) => {
    await request(app.getHttpServer())
      .get('/api/v1/probe/me')
      .set('Authorization', header)
      .expect(401);
  });

  it('accepts a valid token and exposes the auth context', async () => {
    const response = await get('me', await sign(memberOfA)).expect(200);

    expect(response.body).toEqual({
      userId: USER,
      sessionId: SESSION,
      organizationId: ORG_A,
      role: 'STAFF',
      permissions: ['orders.read'],
    });
  });

  it('rejects tokens signed with another key', async () => {
    await get('me', await sign(memberOfA, { key: foreignKey })).expect(401);
  });

  it('rejects tokens for another issuer or audience', async () => {
    await get('me', await sign(memberOfA, { issuer: 'evil-issuer' })).expect(401);
    await get('me', await sign(memberOfA, { audience: 'other-api' })).expect(401);
  });

  it('rejects unsigned tokens (alg: none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        sub: USER,
        sid: SESSION,
        iss: ISSUER,
        aud: AUDIENCE,
        iat: now,
        exp: now + 300,
      }),
    ).toString('base64url');

    await get('me', `${header}.${payload}.c2ln`).expect(401);
  });

  it('reports expired tokens distinctly so clients know to refresh', async () => {
    const expired = await new SignJWT({ sid: SESSION })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(USER)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(privateKey);

    const response = await get('me', expired).expect(401);
    expect(response.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects tokens whose session was revoked', async () => {
    const token = await sign(memberOfA);
    await revocations.revokeSession(SESSION);

    await get('me', token).expect(401);
  });

  it('answers 404 when the route targets another organization', async () => {
    const token = await sign(memberOfA);

    await get(`organizations/${ORG_A}`, token).expect(200);
    const response = await get(`organizations/${ORG_B}`, token).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires an organization context for tenant routes', async () => {
    const response = await get(`organizations/${ORG_A}`, await sign()).expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('enforces permissions from the token, not role names', async () => {
    await get('invite', await sign(memberOfA)).expect(403);
    await get('invite', await sign({ ...memberOfA, perms: ['users.create'] })).expect(200);
  });

  it('enforces explicit role requirements', async () => {
    await get('owner-only', await sign(memberOfA)).expect(403);
    await get('owner-only', await sign({ ...memberOfA, role: 'OWNER' })).expect(200);
  });
});
