import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import {
  atLeastOneField,
  descriptionSchema,
  includeArchivedSchema,
  timestampSchema,
  whenSent,
} from './resource-fields.js';

/** Endpoints: where a tenant's customers receive webhooks (ADR-0025, ADR-0028). */

export const MAX_ENDPOINT_URL_LENGTH = 2048;
export const MAX_CUSTOM_HEADERS = 10;
export const MAX_CUSTOM_HEADER_VALUE_LENGTH = 1024;
export const MAX_ENDPOINT_RATE_LIMIT_PER_SECOND = 1000;
export const MAX_SUBSCRIPTIONS = 100;

const HEADER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex

/** Headers the platform sets or that would corrupt the request; tenants cannot override them. */
const RESERVED_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
  'user-agent',
  'accept-encoding',
  'expect',
]);
const RESERVED_HEADER_PREFIXES = ['webhook-', 'proxy-', 'x-forwarded-', 'sec-'];

export function reservedHeaderReason(name: string): string | undefined {
  const reserved =
    RESERVED_HEADERS.has(name) ||
    RESERVED_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix));
  return reserved ? `The header "${name}" is set by Solmira and cannot be overridden` : undefined;
}

export const customHeadersSchema = z
  .record(
    z.string(),
    z
      .string({ error: whenSent('Header values must be strings, for example "acme"') })
      .max(
        MAX_CUSTOM_HEADER_VALUE_LENGTH,
        `Header values can have at most ${MAX_CUSTOM_HEADER_VALUE_LENGTH} characters`,
      ),
    { error: whenSent('Send headers as a JSON object, for example {"x-tenant-id": "acme"}') },
  )
  .superRefine((headers, context) => {
    const names = Object.keys(headers);
    if (names.length > MAX_CUSTOM_HEADERS)
      context.addIssue({
        code: 'custom',
        message: `Send at most ${MAX_CUSTOM_HEADERS} custom headers; got ${names.length}`,
      });
    for (const name of names) {
      const reason = reservedHeaderReason(name);
      if (!HEADER_NAME.test(name))
        context.addIssue({
          code: 'custom',
          path: [name],
          message:
            'Header names have 1 to 64 lowercase letters, digits and dashes, ' +
            'for example x-tenant-id',
        });
      else if (reason) context.addIssue({ code: 'custom', path: [name], message: reason });
      if (CONTROL_CHARACTERS.test(headers[name] ?? ''))
        context.addIssue({
          code: 'custom',
          path: [name],
          message: 'Header values cannot contain control characters',
        });
    }
  });

const urlSchema = z
  .string()
  .trim()
  .min(1, 'Enter a URL')
  .max(MAX_ENDPOINT_URL_LENGTH, `The URL can have at most ${MAX_ENDPOINT_URL_LENGTH} characters`)
  .meta({ examples: ['https://example.com/webhooks'] });
const rateLimitSchema = z.number().int().min(1).max(MAX_ENDPOINT_RATE_LIMIT_PER_SECOND);
const subscriptionsSchema = z.array(z.uuid()).max(MAX_SUBSCRIPTIONS);

export const endpointSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
  url: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
  rateLimitPerSecond: z.number().int().nullable(),
  headers: z.record(z.string(), z.string()),
  /** Empty means the endpoint receives every event type. */
  eventTypeIds: z.array(z.uuid()),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type Endpoint = z.infer<typeof endpointSchema>;

/** Returned once, when the endpoint is created. Later reads never include the secret. */
export const createdEndpointSchema = endpointSchema.extend({ signingSecret: z.string() });
export type CreatedEndpoint = z.infer<typeof createdEndpointSchema>;

export const createEndpointRequestSchema = z.object({
  url: urlSchema,
  description: descriptionSchema.optional(),
  enabled: z.boolean().default(true),
  rateLimitPerSecond: rateLimitSchema.optional(),
  headers: customHeadersSchema.default({}),
  eventTypeIds: subscriptionsSchema.default([]),
});
export type CreateEndpointRequest = z.infer<typeof createEndpointRequestSchema>;

export const updateEndpointRequestSchema = atLeastOneField(
  z.object({
    url: urlSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    rateLimitPerSecond: rateLimitSchema.nullable().optional(),
    headers: customHeadersSchema.optional(),
    eventTypeIds: subscriptionsSchema.optional(),
  }),
);
export type UpdateEndpointRequest = z.infer<typeof updateEndpointRequestSchema>;

export const endpointListQuerySchema = paginationQuerySchema.extend({
  includeArchived: includeArchivedSchema,
});
export type EndpointListQuery = z.infer<typeof endpointListQuerySchema>;

export const revealedSecretSchema = z.object({ secret: z.string() });
export type RevealedSecret = z.infer<typeof revealedSecretSchema>;

// ---- secret rotation (ADR-0033) -----------------------------------------------------------------

export const DEFAULT_ROTATION_WINDOW_HOURS = 24;
export const MAX_ROTATION_WINDOW_HOURS = 24 * 7;

export const rotateSecretRequestSchema = z.object({
  /** How long the old secret keeps signing next to the new one. */
  windowHours: z
    .number()
    .int()
    .min(1)
    .max(MAX_ROTATION_WINDOW_HOURS)
    .default(DEFAULT_ROTATION_WINDOW_HOURS),
});
export type RotateSecretRequest = z.infer<typeof rotateSecretRequestSchema>;

/** The new secret is returned once; the previous one signs until `previousValidUntil`. */
export const rotatedSecretSchema = z.object({
  secret: z.string(),
  previousValidUntil: timestampSchema,
});
export type RotatedSecret = z.infer<typeof rotatedSecretSchema>;
