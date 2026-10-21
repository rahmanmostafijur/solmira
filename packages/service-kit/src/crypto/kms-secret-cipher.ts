import { open, seal, type EncryptedSecret, type SecretCipher } from './secret-cipher.js';

/** What the cipher needs from a key service: data keys bound to a context, in the clear and wrapped. */
export interface KeyManagement {
  /** A new 256-bit data key. The wrapped form can only be unwrapped with the same `context`. */
  generateDataKey(
    context: Readonly<Record<string, string>>,
  ): Promise<{ plaintext: Buffer; wrapped: Buffer; keyId: string }>;
  /** Unwraps a data key; fails if `context` differs from the one it was generated with. */
  decryptDataKey(
    wrapped: Buffer,
    keyId: string,
    context: Readonly<Record<string, string>>,
  ): Promise<Buffer>;
}

/**
 * Envelope encryption with a key service (AWS KMS in production, ADR-0026 and ADR-0038): every
 * secret has its own data key, the service wraps it, and the key-encryption key never leaves the
 * service. The organization and endpoint are bound twice: as authenticated data of the AES-GCM
 * seal and as the key service's encryption context, which also appears in its audit log.
 */
export class KmsSecretCipher implements SecretCipher {
  constructor(private readonly keys: KeyManagement) {}

  async encrypt(plaintext: string, context: string): Promise<EncryptedSecret> {
    const {
      plaintext: dataKey,
      wrapped,
      keyId,
    } = await this.keys.generateDataKey(encryptionContext(context));
    try {
      return {
        ciphertext: seal(dataKey, Buffer.from(plaintext, 'utf8'), context),
        wrappedDataKey: wrapped,
        keyId,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  async decrypt(secret: EncryptedSecret, context: string): Promise<string> {
    const dataKey = await this.keys.decryptDataKey(
      secret.wrappedDataKey,
      secret.keyId,
      encryptionContext(context),
    );
    try {
      return open(dataKey, secret.ciphertext, context).toString('utf8');
    } finally {
      dataKey.fill(0);
    }
  }
}

/** The context shown in the key service's audit log: what the key is used for, and for which row. */
function encryptionContext(binding: string): Record<string, string> {
  return { purpose: 'webhook-signing-secret', binding };
}
