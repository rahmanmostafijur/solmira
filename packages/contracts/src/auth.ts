import { z } from 'zod';
import { permissionSchema, roleKeySchema } from './access.js';

/**
 * Browser clients send this on cookie-authenticated requests (refresh, logout). A cross-site page
 * cannot add custom headers without a CORS preflight, which the API never approves, so the header
 * is a CSRF defence on top of the SameSite=Strict cookie.
 */
export const CLIENT_HEADER = 'x-solmira-client';
export const REFRESH_COOKIE = 'solmira_refresh';
/** Non-secret hint cookie so the web tier can route signed-out users without an API call. */
export const SESSION_HINT_COOKIE = 'solmira_session';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** NIST 800-63B: length over composition rules; an upper bound protects the hasher from abuse. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

/** Normalise first (pasted addresses often carry spaces or capitals), then validate. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .email('Enter a valid email address, for example ana@example.com')
      .max(254, 'The email address can have at most 254 characters'),
  );

const fullNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .max(120, 'The name can have at most 120 characters');

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No length rules on login: a policy change must never lock out existing accounts.
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const switchOrganizationRequestSchema = z.object({ organizationId: z.uuid() });
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export const tokenRequestSchema = z.object({ token: z.string().min(20).max(200) });

/** The signed-in user's own profile. There is no email here: changing it needs re-verification. */
export const updateProfileRequestSchema = z.object({ fullName: fullNameSchema });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    // Like login, the current password gets no policy; only the new one must meet it.
    currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    message: 'Choose a password different from your current one',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  emailVerified: z.boolean(),
});
export type User = z.infer<typeof userSchema>;

export const activeOrganizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: roleKeySchema,
  permissions: z.array(permissionSchema),
});
export type ActiveOrganization = z.infer<typeof activeOrganizationSchema>;

/** Returned by register, login, refresh and switch-organization. The refresh token is only ever a cookie. */
export const authSessionSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  user: userSchema,
  activeOrganization: activeOrganizationSchema.nullable(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** Claims inside the access token. Short-lived; revocation is enforced separately. */
export const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  org: z.uuid().optional(),
  role: roleKeySchema.optional(),
  perms: z.array(z.string()).optional(),
  iat: z.number().int(),
  /** Millisecond issuance time. `iat` has second precision, too coarse for revocation cut-offs. */
  iat_ms: z.number().int().optional(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
