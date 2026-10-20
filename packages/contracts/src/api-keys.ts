import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import { nameSchema, timestampSchema } from './resource-fields.js';

/** API keys authenticate a tenant's backend against the ingestion API (ADR-0027). */

export const API_KEY_SCOPES = ['messages:write', 'messages:read'] as const;
export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const apiKeySchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  name: z.string(),
  /** The first characters of the key, enough to recognize it in the console. */
  prefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/** Returned once, when the key is created. Only its digest is stored. */
export const createdApiKeySchema = apiKeySchema.extend({ key: z.string() });
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const createApiKeyRequestSchema = z.object({
  name: nameSchema,
  scopes: z
    .array(apiKeyScopeSchema)
    .min(1, 'Choose at least one scope')
    .max(API_KEY_SCOPES.length)
    .default(['messages:write']),
  expiresAt: timestampSchema
    .refine((value) => new Date(value).getTime() > Date.now(), 'The expiry must be in the future')
    .optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export const apiKeyListQuerySchema = paginationQuerySchema.extend({
  includeRevoked: z.stringbool().default(false),
});
export type ApiKeyListQuery = z.infer<typeof apiKeyListQuerySchema>;
