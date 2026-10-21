import { describe, expect, it } from 'vitest';
import { FakeKeyManagement } from '../testing/fake-key-management.js';
import { KmsSecretCipher, type KeyManagement } from './kms-secret-cipher.js';

const context = 'org-1:endpoint-1';

describe('KmsSecretCipher', () => {
  it('round-trips a secret without storing it or its data key in the clear', async () => {
    const keys = new FakeKeyManagement();
    const cipher = new KmsSecretCipher(keys);
    const stored = await cipher.encrypt('whsec_abc', context);

    expect(stored.ciphertext.toString('utf8')).not.toContain('whsec_abc');
    expect(stored.wrappedDataKey.includes(keys.generated[0]!)).toBe(false);
    expect(await cipher.decrypt(stored, context)).toBe('whsec_abc');
  });

  it('uses a new data key for every secret', async () => {
    const keys = new FakeKeyManagement();
    const cipher = new KmsSecretCipher(keys);
    const a = await cipher.encrypt('same', context);
    const b = await cipher.encrypt('same', context);

    expect(keys.calls.generate).toBe(2);
    expect(a.wrappedDataKey.equals(b.wrappedDataKey)).toBe(false);
  });

  it('tells the key service what the key is used for and for which row', async () => {
    const keys = new FakeKeyManagement();
    await new KmsSecretCipher(keys).encrypt('x', context);
    expect(keys.contexts[0]).toEqual({ purpose: 'webhook-signing-secret', binding: context });
  });

  it('is bound to its row twice: by the key service and by the seal itself', async () => {
    const keys = new FakeKeyManagement();
    const cipher = new KmsSecretCipher(keys);
    const stored = await cipher.encrypt('secret', context);

    await expect(cipher.decrypt(stored, 'org-2:endpoint-1')).rejects.toThrow();
    // Even if the key service were fooled into releasing the key, the seal's own context fails.
    const lenient: KeyManagement = {
      generateDataKey: (ctx) => keys.generateDataKey(ctx),
      decryptDataKey: (wrapped, keyId) =>
        keys.decryptDataKey(wrapped, keyId, {
          purpose: 'webhook-signing-secret',
          binding: context,
        }),
    };
    await expect(
      new KmsSecretCipher(lenient).decrypt(stored, 'org-2:endpoint-1'),
    ).rejects.toThrow();
  });

  it('rejects tampering with the ciphertext', async () => {
    const cipher = new KmsSecretCipher(new FakeKeyManagement());
    const stored = await cipher.encrypt('secret', context);
    const flipped = Buffer.from(stored.ciphertext);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 1;
    await expect(cipher.decrypt({ ...stored, ciphertext: flipped }, context)).rejects.toThrow();
  });

  it('wipes the data key from memory once it has been used', async () => {
    const cleartext: Buffer[] = [];
    const keys = new FakeKeyManagement();
    const spying: KeyManagement = {
      generateDataKey: async (ctx) => {
        const result = await keys.generateDataKey(ctx);
        cleartext.push(result.plaintext);
        return result;
      },
      decryptDataKey: async (wrapped, keyId, ctx) => {
        const key = await keys.decryptDataKey(wrapped, keyId, ctx);
        cleartext.push(key);
        return key;
      },
    };
    const cipher = new KmsSecretCipher(spying);
    const stored = await cipher.encrypt('secret', context);
    await cipher.decrypt(stored, context);

    expect(cleartext).toHaveLength(2);
    for (const key of cleartext) expect(key.every((byte) => byte === 0)).toBe(true);
  });

  it('fails closed when the key service fails', async () => {
    const down: KeyManagement = {
      generateDataKey: () => Promise.reject(new Error('KMS unavailable')),
      decryptDataKey: () => Promise.reject(new Error('KMS unavailable')),
    };
    const cipher = new KmsSecretCipher(down);
    await expect(cipher.encrypt('secret', context)).rejects.toThrow('KMS unavailable');
    const stored = await new KmsSecretCipher(new FakeKeyManagement()).encrypt('secret', context);
    await expect(cipher.decrypt(stored, context)).rejects.toThrow('KMS unavailable');
  });
});
