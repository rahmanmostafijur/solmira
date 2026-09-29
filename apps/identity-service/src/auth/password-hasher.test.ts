import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.js';
import { generateOpaqueToken, hashToken } from './secrets.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('produces Argon2id hashes with the configured cost parameters', async () => {
    const hashed = await hasher.hash('correct horse battery staple');

    expect(hashed).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hashed).not.toContain('correct horse');
  });

  it('salts every hash, so equal passwords produce different hashes', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('same password!'),
      hasher.hash('same password!'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hashed = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify(hashed, 'correct horse battery staple')).toBe(true);
    expect(await hasher.verify(hashed, 'Correct horse battery staple')).toBe(false);
  });

  it('treats a corrupt hash as a failed verification instead of throwing', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
  });

  it('always rejects the timing-equaliser path', async () => {
    expect(await hasher.verifyAgainstDummy('timing-equaliser-not-a-real-password')).toBe(false);
  });
});

describe('opaque tokens', () => {
  it('are 256-bit URL-safe strings stored only as SHA-256 hashes', () => {
    const token = generateOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(generateOpaqueToken()).not.toBe(token);
  });
});
