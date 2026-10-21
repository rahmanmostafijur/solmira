import { z } from 'zod';

/** Field building blocks shared by the webhook resource contracts. */
export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(MAX_NAME_LENGTH, `The name can have at most ${MAX_NAME_LENGTH} characters`)
  .meta({ examples: ['Billing'] });
export const descriptionSchema = z
  .string()
  .trim()
  .max(
    MAX_DESCRIPTION_LENGTH,
    `The description can have at most ${MAX_DESCRIPTION_LENGTH} characters`,
  );

/**
 * A message for a value that was sent but is wrong. A missing value keeps the generic wording
 * ("from is required"), which names the field; a schema-wide message would hide that.
 */
export const whenSent =
  (message: string) =>
  (issue: { readonly input?: unknown }): string | undefined =>
    issue.input === undefined ? undefined : message;

export const timestampSchema = z.iso.datetime({
  error: whenSent('Use an ISO 8601 date-time in UTC, for example 2026-10-01T12:00:00Z'),
});

/** List filter: archived resources are hidden unless asked for. */
export const includeArchivedSchema = z
  .stringbool({ error: whenSent('Use true or false, for example includeArchived=true') })
  .default(false);

/** An update request must change something; `undefined` means "leave as is". */
export function atLeastOneField<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Send at least one field to change',
  });
}
