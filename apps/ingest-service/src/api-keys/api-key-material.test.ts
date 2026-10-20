import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, isWellFormedApiKey } from './api-key-material.js';

describe('API key material', () => {
  it('generates a well-formed key with a display prefix and a SHA-256 digest', () => {
    const { key, prefix, hash } = generateApiKey();
    expect(isWellFormedApiKey(key)).toBe(true);
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(hash);
    expect(hash).not.toContain(key);
  });

  it('generates a different key every time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key));
    expect(keys.size).toBe(50);
  });

  it('recognizes malformed keys before touching the database', () => {
    const { key } = generateApiKey();
    for (const bad of ['', 'slm_', key + 'x', key.slice(1), key.replace('slm_', 'sk_'), ' ' + key])
      expect(isWellFormedApiKey(bad), bad).toBe(false);
  });

  it('hashes deterministically and differently for different keys', () => {
    expect(hashApiKey('a')).toBe(hashApiKey('a'));
    expect(hashApiKey('a')).not.toBe(hashApiKey('b'));
  });
});
