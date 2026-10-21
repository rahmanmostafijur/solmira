import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LocalSecretCipher } from './secret-cipher.js';

const key = () => randomBytes(32).toString('base64');
const context = 'org-1:endpoint-1';

describe('LocalSecretCipher', () => {
  it('round-trips a secret and never stores it in the clear', async () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const secret = 'whsec_' + randomBytes(32).toString('base64');
    const stored = await cipher.encrypt(secret, context);

    expect(stored.ciphertext.toString('utf8')).not.toContain(secret);
    expect(stored.keyId).toBe('k1');
    expect(await cipher.decrypt(stored, context)).toBe(secret);
  });

  it('encrypts the same secret differently each time', async () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const a = await cipher.encrypt('same', context);
    const b = await cipher.encrypt('same', context);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDataKey.equals(b.wrappedDataKey)).toBe(false);
  });

  it('is bound to its organization and endpoint', async () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const stored = await cipher.encrypt('secret', context);
    await expect(cipher.decrypt(stored, 'org-2:endpoint-1')).rejects.toThrow();
    await expect(cipher.decrypt(stored, 'org-1:endpoint-2')).rejects.toThrow();
  });

  it('rejects tampering and a different key-encryption key', async () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const stored = await cipher.encrypt('secret', context);
    const flipped = Buffer.from(stored.ciphertext);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;

    await expect(cipher.decrypt({ ...stored, ciphertext: flipped }, context)).rejects.toThrow();
    await expect(new LocalSecretCipher(key(), 'k1').decrypt(stored, context)).rejects.toThrow();
  });

  it('refuses a secret wrapped by a key it does not know', async () => {
    const cipher = new LocalSecretCipher(key(), 'k1');
    const stored = await cipher.encrypt('secret', context);
    await expect(cipher.decrypt({ ...stored, keyId: 'k0' }, context)).rejects.toThrow(
      'unknown key',
    );
  });
});
