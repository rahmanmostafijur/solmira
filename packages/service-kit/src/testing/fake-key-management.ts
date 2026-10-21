import { randomBytes } from 'node:crypto';
import type { KeyManagement } from '../crypto/kms-secret-cipher.js';
import { open, seal } from '../crypto/secret-cipher.js';

export const FAKE_KEY_ID =
  'arn:aws:kms:eu-west-1:123456789012:key/11111111-2222-3333-4444-555555555555';

/**
 * A key service of our own for tests: the wrapping key never leaves it, and a data key can only be
 * unwrapped with the encryption context it was made with, as with KMS.
 */
export class FakeKeyManagement implements KeyManagement {
  private readonly masterKey = randomBytes(32);
  readonly generated: Buffer[] = [];
  readonly contexts: Record<string, string>[] = [];
  readonly calls = { generate: 0, decrypt: 0 };

  async generateDataKey(ctx: Readonly<Record<string, string>>) {
    this.calls.generate += 1;
    this.contexts.push({ ...ctx });
    const plaintext = randomBytes(32);
    this.generated.push(plaintext);
    return {
      plaintext: Buffer.from(plaintext),
      wrapped: seal(this.masterKey, plaintext, JSON.stringify(ctx)),
      keyId: FAKE_KEY_ID,
    };
  }

  async decryptDataKey(wrapped: Buffer, keyId: string, ctx: Readonly<Record<string, string>>) {
    this.calls.decrypt += 1;
    if (keyId !== FAKE_KEY_ID) throw new Error('wrong key');
    return open(this.masterKey, wrapped, JSON.stringify(ctx));
  }
}
