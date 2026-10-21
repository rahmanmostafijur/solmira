import { z } from 'zod';
import { permissionSchema, roleKeySchema } from './access.js';
import { emailSchema } from './auth.js';

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

const organizationNameSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(100, 'The organization name can have at most 100 characters')
  .meta({ examples: ['Acme Corp'] });

export const createOrganizationRequestSchema = z.object({
  name: organizationNameSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      SLUG_PATTERN,
      'Lowercase letters, numbers and hyphens only, 1 to 48 characters, for example acme-corp',
    )
    .meta({ examples: ['acme-corp'] })
    .optional(),
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

const timezoneSchema = z.string().refine(
  (zone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown time zone; use an IANA name, for example Europe/Berlin' },
);

export const updateOrganizationRequestSchema = z
  .object({
    name: organizationNameSchema,
    timezone: timezoneSchema,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code, for example EUR'),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(['active', 'suspended']),
  timezone: z.string(),
  currency: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const membershipSummarySchema = z.object({
  organization: organizationSchema.pick({ id: true, name: true, slug: true }),
  role: roleKeySchema,
  status: z.enum(['active', 'suspended']),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const MEMBER_STATUSES = ['active', 'suspended'] as const;

export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: roleKeySchema,
  status: z.enum(MEMBER_STATUSES),
  createdAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberRequestSchema = z
  .object({ role: roleKeySchema, status: z.enum(MEMBER_STATUSES) })
  .partial()
  .refine((body) => body.role !== undefined || body.status !== undefined, {
    message: 'Provide a role or a status',
  });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const createInvitationRequestSchema = z.object({ email: emailSchema, role: roleKeySchema });
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: roleKeySchema,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const roleSummarySchema = z.object({
  key: roleKeySchema,
  name: z.string(),
  description: z.string(),
  rank: z.number().int(),
  permissions: z.array(permissionSchema),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    fullName: z.string(),
    emailVerified: z.boolean(),
  }),
  memberships: z.array(membershipSummarySchema),
  activeOrganizationId: z.uuid().nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
