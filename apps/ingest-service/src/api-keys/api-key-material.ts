import { createHash, randomBytes } from 'node:crypto';

const KEY_PREFIX = 'slm_';
const KEY_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;
/** `slm_` plus 32 random bytes in unpadded base64url (43 characters). */
const KEY_FORMAT = /^slm_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  readonly key: string;
  readonly prefix: string;
  readonly hash: string;
}

/** Only the digest of a key is stored. Keys are random with 256 bits, so SHA-256 is enough. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function isWellFormedApiKey(value: string): boolean {
  return KEY_FORMAT.test(value);
}

export function generateApiKey(): GeneratedApiKey {
  const key = KEY_PREFIX + randomBytes(KEY_BYTES).toString('base64url');
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashApiKey(key) };
}
