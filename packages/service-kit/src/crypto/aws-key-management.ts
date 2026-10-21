import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import type { KeyManagement } from './kms-secret-cipher.js';

export interface AwsKeyManagementOptions {
  /** The ARN of the key new data keys are made under; KMS reports this ARN as the key id of a data key. */
  readonly keyId: string;
  readonly region?: string | undefined;
  /** Key ids a data key may have been wrapped under: the current key, and earlier ones after a rotation. */
  readonly acceptedKeyIds?: readonly string[];
  readonly client?: KMSClient;
}

/**
 * AWS KMS as a key service. Decrypt is always called with the key id stored beside the secret and
 * refused for keys not in the accepted list, so a row cannot point this service at some other key.
 * Credentials and region come from the environment (the task role in ECS); nothing is configured here.
 */
export class AwsKeyManagement implements KeyManagement {
  private readonly client: KMSClient;
  private readonly accepted: ReadonlySet<string>;

  constructor(private readonly options: AwsKeyManagementOptions) {
    this.client = options.client ?? new KMSClient({ region: options.region });
    this.accepted = new Set([options.keyId, ...(options.acceptedKeyIds ?? [])]);
  }

  async generateDataKey(context: Readonly<Record<string, string>>) {
    const response = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: this.options.keyId,
        KeySpec: 'AES_256',
        EncryptionContext: { ...context },
      }),
    );
    if (!response.Plaintext || !response.CiphertextBlob || !response.KeyId) {
      throw new Error('KMS returned an incomplete data key');
    }
    return {
      plaintext: Buffer.from(response.Plaintext),
      wrapped: Buffer.from(response.CiphertextBlob),
      // The full ARN of the key that was used, whatever alias was asked for.
      keyId: response.KeyId,
    };
  }

  async decryptDataKey(
    wrapped: Buffer,
    keyId: string,
    context: Readonly<Record<string, string>>,
  ): Promise<Buffer> {
    if (!this.accepted.has(keyId)) {
      throw new Error(`Secret was wrapped by a key this service does not accept: ${keyId}`);
    }
    const response = await this.client.send(
      new DecryptCommand({
        CiphertextBlob: wrapped,
        KeyId: keyId,
        EncryptionContext: { ...context },
      }),
    );
    if (!response.Plaintext) throw new Error('KMS returned no plaintext');
    return Buffer.from(response.Plaintext);
  }
}
