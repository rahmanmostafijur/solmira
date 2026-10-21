import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import {
  atLeastOneField,
  descriptionSchema,
  includeArchivedSchema,
  nameSchema,
  timestampSchema,
  whenSent,
} from './resource-fields.js';

/** Applications and event types (ADR-0025). Both are archived, never hard deleted. */

export const applicationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type Application = z.infer<typeof applicationSchema>;

export const createApplicationRequestSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.optional(),
});
export type CreateApplicationRequest = z.infer<typeof createApplicationRequestSchema>;

export const updateApplicationRequestSchema = atLeastOneField(
  z.object({
    name: nameSchema.optional(),
    description: descriptionSchema.nullable().optional(),
  }),
);
export type UpdateApplicationRequest = z.infer<typeof updateApplicationRequestSchema>;

export const applicationListQuerySchema = paginationQuerySchema.extend({
  includeArchived: includeArchivedSchema,
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

export const EVENT_TYPE_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
export const MAX_EVENT_TYPE_SCHEMA_BYTES = 64 * 1024;

export const eventTypeNameSchema = z
  .string()
  .regex(
    EVENT_TYPE_NAME_PATTERN,
    'Event type names have 1 to 128 lowercase letters, digits, dots, dashes and underscores, ' +
      'starting with a letter or digit, for example invoice.paid',
  )
  .meta({ examples: ['invoice.paid'] });

const jsonSchemaDocument = z
  .record(z.string(), z.unknown(), {
    error: whenSent('The schema must be a JSON Schema object, for example {"type": "object"}'),
  })
  .refine(
    (value) => JSON.stringify(value).length <= MAX_EVENT_TYPE_SCHEMA_BYTES,
    `The schema can be at most ${MAX_EVENT_TYPE_SCHEMA_BYTES / 1024} KiB of JSON; remove unused parts`,
  );

export const eventTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  schema: z.record(z.string(), z.unknown()).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type EventType = z.infer<typeof eventTypeSchema>;

export const createEventTypeRequestSchema = z.object({
  name: eventTypeNameSchema.refine(
    (name) => !name.startsWith('solmira.'),
    'Names starting with solmira. are reserved for the platform; choose another prefix',
  ),
  description: descriptionSchema.optional(),
  schema: jsonSchemaDocument.optional(),
});
export type CreateEventTypeRequest = z.infer<typeof createEventTypeRequestSchema>;

/** The name never changes; `schema: null` removes payload validation. */
export const updateEventTypeRequestSchema = atLeastOneField(
  z.object({
    description: descriptionSchema.nullable().optional(),
    schema: jsonSchemaDocument.nullable().optional(),
  }),
);
export type UpdateEventTypeRequest = z.infer<typeof updateEventTypeRequestSchema>;

export const eventTypeListQuerySchema = paginationQuerySchema.extend({
  includeArchived: includeArchivedSchema,
});
export type EventTypeListQuery = z.infer<typeof eventTypeListQuerySchema>;
