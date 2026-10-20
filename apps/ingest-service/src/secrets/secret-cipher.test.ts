import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LocalSecretCipher } from './secret-cipher.js';
import { generateSigningSecret } from './signing-secret.js';

const key = () => randomBytes(32).toString('base64');

describe('LocalSecretCipher', () => {
  const context = 'org-1:endpoint-1';

  it('round-trips a secret and never stores it in the clear', () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const secret = generateSigningSecret();
    const stored = cipher.encrypt(secret, context);
    expect(stored.keyId).toBe('k1');
    expect(stored.ciphertext.includes(Buffer.from(secret))).toBe(false);
    expect(cipher.decrypt(stored, context)).toBe(secret);
  });

  it('uses a fresh data key and nonce for every encryption', () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const a = cipher.encrypt('same', context);
    const b = cipher.encrypt('same', context);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDataKey.equals(b.wrappedDataKey)).toBe(false);
  });

  it('refuses a ciphertext moved to another organization or endpoint', () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const stored = cipher.encrypt('secret', context);
    expect(() => cipher.decrypt(stored, 'org-2:endpoint-1')).toThrow();
    expect(() => cipher.decrypt(stored, 'org-1:endpoint-2')).toThrow();
  });

  it('refuses tampered data and the wrong key-encryption key', () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const stored = cipher.encrypt('secret', context);
    const flipped = Buffer.from(stored.ciphertext);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    expect(() => cipher.decrypt({ ...stored, ciphertext: flipped }, context)).toThrow();
    expect(() => new LocalSecretCipher(key(), 'k1').decrypt(stored, context)).toThrow();
  });

  it('refuses a secret that was wrapped by a different key id', () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const stored = cipher.encrypt('secret', context);
    expect(() => cipher.decrypt({ ...stored, keyId: 'k0' }, context)).toThrow('unknown key');
  });
});

describe('generateSigningSecret', () => {
  it('follows the Standard Webhooks format with 32 random bytes', () => {
    const secret = generateSigningSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(secret.slice(6), 'base64')).toHaveLength(32);
    expect(generateSigningSecret()).not.toBe(secret);
  });
});
