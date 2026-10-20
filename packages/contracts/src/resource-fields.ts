import { z } from 'zod';

/** Field building blocks shared by the webhook resource contracts. */
export const nameSchema = z.string().trim().min(1, 'Enter a name').max(100);
export const descriptionSchema = z.string().trim().max(500);
export const timestampSchema = z.iso.datetime();

/** List filter: archived resources are hidden unless asked for. */
export const includeArchivedSchema = z.stringbool().default(false);

/** An update request must change something; `undefined` means "leave as is". */
export function atLeastOneField<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Send at least one field to change',
  });
}
