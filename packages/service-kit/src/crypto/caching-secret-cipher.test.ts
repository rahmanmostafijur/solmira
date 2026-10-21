import { describe, expect, it } from 'vitest';
import { FakeKeyManagement } from '../testing/fake-key-management.js';
import { CachingSecretCipher } from './caching-secret-cipher.js';
import { KmsSecretCipher } from './kms-secret-cipher.js';

const context = 'org-1:endpoint-1';

function setup(options: { ttlMs?: number; maxEntries?: number } = {}) {
  const keys = new FakeKeyManagement();
  let now = 1_000;
  const cipher = new CachingSecretCipher(new KmsSecretCipher(keys), {
    ttlMs: options.ttlMs ?? 60_000,
    maxEntries: options.maxEntries ?? 100,
    now: () => now,
  });
  return { keys, cipher, advance: (ms: number) => (now += ms) };
}

describe('CachingSecretCipher', () => {
  it('asks the key service once while the answer is fresh', async () => {
    const { keys, cipher } = setup();
    const stored = await cipher.encrypt('whsec_abc', context);

    expect(await cipher.decrypt(stored, context)).toBe('whsec_abc');
    expect(await cipher.decrypt(stored, context)).toBe('whsec_abc');
    expect(keys.calls.decrypt).toBe(1);
  });

  it('asks again after the time to live', async () => {
    const { keys, cipher, advance } = setup({ ttlMs: 1_000 });
    const stored = await cipher.encrypt('whsec_abc', context);
    await cipher.decrypt(stored, context);
    advance(1_001);
    await cipher.decrypt(stored, context);
    expect(keys.calls.decrypt).toBe(2);
  });

  it('never answers a different row from the cache', async () => {
    const { cipher } = setup();
    const stored = await cipher.encrypt('whsec_abc', context);
    await cipher.decrypt(stored, context);
    // The cached value belongs to this row; another row's context must still fail.
    await expect(cipher.decrypt(stored, 'org-2:endpoint-1')).rejects.toThrow();
  });

  it('does not cache a failure', async () => {
    const { keys, cipher } = setup();
    const stored = await cipher.encrypt('whsec_abc', context);
    await expect(cipher.decrypt(stored, 'org-9:endpoint-9')).rejects.toThrow();
    await expect(cipher.decrypt(stored, 'org-9:endpoint-9')).rejects.toThrow();
    expect(keys.calls.decrypt).toBe(2);
  });

  it('holds a bounded number of secrets, dropping the oldest', async () => {
    const { keys, cipher } = setup({ maxEntries: 2 });
    const a = await cipher.encrypt('a', 'ctx-a');
    const b = await cipher.encrypt('b', 'ctx-b');
    const c = await cipher.encrypt('c', 'ctx-c');
    await cipher.decrypt(a, 'ctx-a');
    await cipher.decrypt(b, 'ctx-b');
    await cipher.decrypt(c, 'ctx-c');
    expect(keys.calls.decrypt).toBe(3);

    await cipher.decrypt(c, 'ctx-c');
    await cipher.decrypt(b, 'ctx-b');
    expect(keys.calls.decrypt).toBe(3);
    await cipher.decrypt(a, 'ctx-a');
    expect(keys.calls.decrypt).toBe(4);
  });

  it('never caches encryption', async () => {
    const { keys, cipher } = setup();
    await cipher.encrypt('same', context);
    await cipher.encrypt('same', context);
    expect(keys.calls.generate).toBe(2);
  });
});
