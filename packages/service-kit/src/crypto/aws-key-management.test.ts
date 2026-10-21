import type { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { describe, expect, it } from 'vitest';
import { AwsKeyManagement } from './aws-key-management.js';

const KEY = 'arn:aws:kms:eu-west-1:123456789012:key/11111111-2222-3333-4444-555555555555';
const OLD_KEY = 'arn:aws:kms:eu-west-1:123456789012:key/99999999-8888-7777-6666-555555555555';
const context = { purpose: 'webhook-signing-secret', binding: 'org-1:endpoint-1' };

function fakeClient(respond: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  const client = { send: async (command: unknown) => (sent.push(command), respond(command)) };
  return { sent, client: client as unknown as KMSClient };
}

describe('AwsKeyManagement', () => {
  it('asks KMS for a 256-bit data key under the configured key with the context', async () => {
    const { sent, client } = fakeClient(() => ({
      Plaintext: new Uint8Array(32).fill(7),
      CiphertextBlob: new Uint8Array([1, 2, 3]),
      KeyId: KEY,
    }));
    const keys = new AwsKeyManagement({ keyId: KEY, client });

    const result = await keys.generateDataKey(context);

    const input = (sent[0] as GenerateDataKeyCommand).input;
    expect(input).toEqual({ KeyId: KEY, KeySpec: 'AES_256', EncryptionContext: context });
    expect(result.plaintext).toHaveLength(32);
    expect(result.wrapped).toEqual(Buffer.from([1, 2, 3]));
    expect(result.keyId).toBe(KEY);
  });

  it('refuses an incomplete answer instead of using a partial key', async () => {
    const { client } = fakeClient(() => ({ Plaintext: new Uint8Array(32) }));
    await expect(
      new AwsKeyManagement({ keyId: KEY, client }).generateDataKey(context),
    ).rejects.toThrow('incomplete');
  });

  it('unwraps with the stored key id and the same context', async () => {
    const { sent, client } = fakeClient(() => ({ Plaintext: new Uint8Array(32).fill(9) }));
    const keys = new AwsKeyManagement({ keyId: KEY, client });

    const key = await keys.decryptDataKey(Buffer.from([4, 5]), KEY, context);

    const input = (sent[0] as DecryptCommand).input;
    expect(input).toEqual({
      CiphertextBlob: Buffer.from([4, 5]),
      KeyId: KEY,
      EncryptionContext: context,
    });
    expect(key.every((byte) => byte === 9)).toBe(true);
  });

  it('refuses a key it was not configured to accept, without calling KMS', async () => {
    const { sent, client } = fakeClient(() => ({ Plaintext: new Uint8Array(32) }));
    const keys = new AwsKeyManagement({ keyId: KEY, client });
    await expect(keys.decryptDataKey(Buffer.from([1]), OLD_KEY, context)).rejects.toThrow(
      'does not accept',
    );
    expect(sent).toHaveLength(0);
  });

  it('accepts earlier keys after a key change', async () => {
    const { client } = fakeClient(() => ({ Plaintext: new Uint8Array(32) }));
    const keys = new AwsKeyManagement({ keyId: KEY, acceptedKeyIds: [OLD_KEY], client });
    await expect(keys.decryptDataKey(Buffer.from([1]), OLD_KEY, context)).resolves.toHaveLength(32);
  });
});
