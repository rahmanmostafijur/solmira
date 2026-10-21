import { createLocalJWKSet, exportPKCS8, exportSPKI, generateKeyPair, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { envSchema, type IdentityConfig } from '../config.js';
import { AccessTokenIssuer } from './access-token-issuer.js';

async function keyPair(kid: string) {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
  return {
    kid,
    privatePem: await exportPKCS8(privateKey),
    publicPem: await exportSPKI(publicKey),
  };
}

function issuerFor(
  current: Awaited<ReturnType<typeof keyPair>>,
  previous: Awaited<ReturnType<typeof keyPair>>[] = [],
) {
  return new AccessTokenIssuer({
    JWT_PRIVATE_KEY: current.privatePem,
    JWT_PUBLIC_KEY: current.publicPem,
    JWT_KEY_ID: current.kid,
    JWT_ISSUER: 'solmira-identity',
    JWT_AUDIENCE: 'solmira-api',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    JWT_PREVIOUS_PUBLIC_KEYS: previous.map((key) => ({ kid: key.kid, publicKey: key.publicPem })),
  } as unknown as IdentityConfig);
}

const issue = (issuer: AccessTokenIssuer) =>
  issuer.issue({ userId: crypto.randomUUID(), sessionId: crypto.randomUUID(), access: null });

describe('AccessTokenIssuer key rotation', () => {
  it('publishes only the current key when nothing was rotated', async () => {
    const current = await keyPair('identity-2');
    const { keys } = await issuerFor(current).jwks();
    expect(keys.map((key) => key.kid)).toEqual(['identity-2']);
  });

  it('keeps tokens signed with the previous key valid next to tokens signed with the new one', async () => {
    const oldKey = await keyPair('identity-1');
    const newKey = await keyPair('identity-2');
    const oldToken = (await issue(issuerFor(oldKey))).token;
    const rotated = issuerFor(newKey, [oldKey]);
    const newToken = (await issue(rotated)).token;

    const keys = createLocalJWKSet(await rotated.jwks());
    await expect(jwtVerify(oldToken, keys, { audience: 'solmira-api' })).resolves.toBeDefined();
    await expect(jwtVerify(newToken, keys, { audience: 'solmira-api' })).resolves.toBeDefined();
  });

  it('stops accepting the old key once its entry is removed', async () => {
    const oldKey = await keyPair('identity-1');
    const newKey = await keyPair('identity-2');
    const oldToken = (await issue(issuerFor(oldKey))).token;
    const keys = createLocalJWKSet(await issuerFor(newKey).jwks());
    await expect(jwtVerify(oldToken, keys, { audience: 'solmira-api' })).rejects.toThrow();
  });
});

describe('JWT_PREVIOUS_PUBLIC_KEYS', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    RABBITMQ_URL: 'amqp://u:p@localhost:5672',
    JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
  };

  it('defaults to none and reads a list of key ids with public keys', () => {
    expect(envSchema.parse(base).JWT_PREVIOUS_PUBLIC_KEYS).toEqual([]);
    const listed = envSchema.parse({
      ...base,
      JWT_PREVIOUS_PUBLIC_KEYS: JSON.stringify([
        {
          kid: 'identity-1',
          publicKey: '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----',
        },
      ]),
    });
    expect(listed.JWT_PREVIOUS_PUBLIC_KEYS[0]).toMatchObject({ kid: 'identity-1' });
    expect(listed.JWT_PREVIOUS_PUBLIC_KEYS[0]!.publicKey).toContain('\n');
  });

  it('refuses text that is not that list', () => {
    expect(envSchema.safeParse({ ...base, JWT_PREVIOUS_PUBLIC_KEYS: 'not json' }).success).toBe(
      false,
    );
    expect(
      envSchema.safeParse({ ...base, JWT_PREVIOUS_PUBLIC_KEYS: '[{"kid":"x","publicKey":"nope"}]' })
        .success,
    ).toBe(false);
  });
});
