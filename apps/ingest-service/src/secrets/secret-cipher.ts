import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** A secret as stored: nothing in it is usable without the key-encryption key. */
export interface EncryptedSecret {
  readonly ciphertext: Buffer;
  readonly wrappedDataKey: Buffer;
  readonly keyId: string;
}

/**
 * Encrypts signing secrets (ADR-0026). `context` is authenticated but not stored: it binds a
 * ciphertext to its organization and endpoint, so copying it into another row fails to decrypt.
 * The local implementation reads a key from the environment; KMS replaces it in AWS.
 */
export interface SecretCipher {
  encrypt(plaintext: string, context: string): EncryptedSecret;
  decrypt(secret: EncryptedSecret, context: string): string;
}

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function seal(key: Buffer, plaintext: Buffer, context: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function open(key: Buffer, sealed: Buffer, context: string): Buffer {
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** Envelope encryption with a local key-encryption key: a fresh data key per secret. */
export class LocalSecretCipher implements SecretCipher {
  private readonly keyEncryptionKey: Buffer;

  constructor(
    base64Key: string,
    private readonly keyId: string,
  ) {
    this.keyEncryptionKey = Buffer.from(base64Key, 'base64');
  }

  encrypt(plaintext: string, context: string): EncryptedSecret {
    const dataKey = randomBytes(32);
    return {
      ciphertext: seal(dataKey, Buffer.from(plaintext, 'utf8'), context),
      wrappedDataKey: seal(this.keyEncryptionKey, dataKey, context),
      keyId: this.keyId,
    };
  }

  decrypt(secret: EncryptedSecret, context: string): string {
    if (secret.keyId !== this.keyId)
      throw new Error(`Secret was encrypted with unknown key "${secret.keyId}"`);
    const dataKey = open(this.keyEncryptionKey, secret.wrappedDataKey, context);
    return open(dataKey, secret.ciphertext, context).toString('utf8');
  }
}
