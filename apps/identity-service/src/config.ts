import {
  baseEnvSchema,
  portSchema,
  postgresEnvSchema,
  rabbitmqEnvSchema,
  redisEnvSchema,
} from '@solmira/service-kit';
import { z } from 'zod';

export const SERVICE_NAME = 'identity-service';

/** PEM keys arrive through env vars with escaped newlines ("\n"); restore them. */
const pemSchema = z
  .string()
  .min(1)
  .transform((value) => value.replace(/\\n/g, '\n'))
  .refine((value) => value.includes('-----BEGIN'), { message: 'Must be a PEM-encoded key' });

const previousKeysSchema = z.array(
  z.object({
    kid: z.string().min(1),
    publicKey: z
      .string()
      .transform((value) => value.replace(/\\n/g, '\n'))
      .refine((value) => value.includes('-----BEGIN PUBLIC KEY'), 'Must be a PEM public key'),
  }),
);

export const envSchema = baseEnvSchema.extend({
  PORT: portSchema(4001),
  ...postgresEnvSchema.shape,
  ...redisEnvSchema.shape,
  ...rabbitmqEnvSchema.shape,

  // Ed25519 signing key pair (`pnpm --filter @solmira/identity-service keys:generate`).
  // Only identity-service holds the private key; other services get the public key.
  JWT_PRIVATE_KEY: pemSchema,
  JWT_PUBLIC_KEY: pemSchema,
  JWT_KEY_ID: z.string().min(1).default('identity-1'),
  /**
   * Public keys of earlier signing keys, still published so tokens signed with them stay valid until
   * they expire (a rotation, docs/operations/key-rotation.md). JSON: [{"kid": "identity-1", "publicKey": "<PEM>"}].
   * Remove an entry once an access token lifetime has passed.
   */
  JWT_PREVIOUS_PUBLIC_KEYS: z
    .string()
    .default('[]')
    .transform((value, context) => {
      try {
        return previousKeysSchema.parse(JSON.parse(value));
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'Must be JSON: [{"kid": "...", "publicKey": "<PEM>"}]',
        });
        return z.NEVER;
      }
    }),
  JWT_ISSUER: z.string().min(1).default('solmira-identity'),
  JWT_AUDIENCE: z.string().min(1).default('solmira-api'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /** Idle timeout: a session unused for this long cannot be refreshed. */
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .default(7 * 24 * 3600),
  /** Absolute lifetime: sessions end after this regardless of activity. */
  SESSION_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(30 * 24 * 3600),
  // Browsers treat http://localhost as a secure context, so Secure cookies work in local dev too.
  COOKIE_SECURE: z.stringbool().default(true),

  APP_URL: z.url().default('http://localhost:8080'),
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  MAIL_FROM: z.string().min(3).default('Solmira <no-reply@solmira.local>'),

  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .default(15 * 60),
});

export type IdentityConfig = z.infer<typeof envSchema>;
