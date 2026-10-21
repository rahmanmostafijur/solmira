import type { EncryptedSecret, SecretCipher } from './secret-cipher.js';

export interface CacheOptions {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

/**
 * Remembers decrypted secrets for a short time so a busy sender does not call the key service for
 * every request. The cache is in process memory, bounded and expiring, and holds nothing the process
 * does not already hold while it signs. Encryption is never cached.
 */
export class CachingSecretCipher implements SecretCipher {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  private readonly now: () => number;

  constructor(
    private readonly inner: SecretCipher,
    private readonly options: CacheOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  encrypt(plaintext: string, context: string): Promise<EncryptedSecret> {
    return this.inner.encrypt(plaintext, context);
  }

  async decrypt(secret: EncryptedSecret, context: string): Promise<string> {
    // Context and key id are part of the key: a hit can only come from the same row and the same key.
    const key = `${secret.keyId}|${context}|${secret.wrappedDataKey.toString('base64')}`;
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    this.entries.delete(key);

    const value = await this.inner.decrypt(secret, context);
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
    if (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return value;
  }
}
