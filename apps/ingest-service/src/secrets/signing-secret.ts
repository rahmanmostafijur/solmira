import { randomBytes } from 'node:crypto';

const SECRET_PREFIX = 'whsec_';
const SECRET_BYTES = 32;

/** A Standard Webhooks signing secret: `whsec_` plus base64 of 32 random bytes. */
export function generateSigningSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64')}`;
}
