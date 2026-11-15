'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { eventTypeNameSchema, type EventType } from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextAreaField, TextField } from '@/components/ui/field';
import { applyServerError } from '@/lib/forms';
import { parseJsonObject } from '@/lib/json-text';

const editableFields = z.object({
  description: z.string().trim().max(500),
  schema: z.string().refine((text) => text.trim() === '' || 'value' in parseJsonObject(text), {
    message: 'Enter a JSON object, or leave this empty',
  }),
});
const createSchema = editableFields.extend({
  name: eventTypeNameSchema.refine(
    (name) => !name.startsWith('solmira.'),
    'Names starting with solmira. are reserved for the platform',
  ),
});
// The name never changes once created, so editing does not validate it again.
const editSchema = editableFields.extend({ name: z.string() });
type Values = z.infer<typeof createSchema>;

export interface EventTypeSubmission {
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
}

/**
 * Creates an event type: a name such as invoice.paid, and an optional JSON Schema for payloads.
 * With `initial` it edits one instead; the name is then shown but cannot be changed.
 */
export function EventTypeForm({
  onSubmit,
  onCancel,
  initial,
  submitLabel = 'Create event type',
}: {
  onSubmit: (values: EventTypeSubmission) => Promise<unknown>;
  onCancel: () => void;
  initial?: Pick<EventType, 'name' | 'description' | 'schema'>;
  submitLabel?: string;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(initial ? editSchema : createSchema),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      schema: initial?.schema ? JSON.stringify(initial.schema, null, 2) : '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    const parsed = values.schema.trim() === '' ? undefined : parseJsonObject(values.schema);
    try {
      await onSubmit({
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        ...(parsed && 'value' in parsed ? { schema: parsed.value } : {}),
      });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <TextField
        label="Name"
        placeholder="invoice.paid"
        hint={
          initial
            ? 'The name cannot change: senders and endpoints refer to it.'
            : 'Lowercase letters, digits, dots, dashes and underscores.'
        }
        readOnly={initial !== undefined}
        className={initial ? 'bg-canvas text-ink-muted' : undefined}
        error={errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label="Description"
        hint="Optional"
        error={errors.description?.message}
        {...form.register('description')}
      />
      <TextAreaField
        label="Payload schema"
        hint={
          initial
            ? 'Optional JSON Schema (draft 2020-12). Leave empty to stop validating payloads.'
            : 'Optional JSON Schema (draft 2020-12). Messages that do not match are rejected.'
        }
        placeholder='{ "type": "object", "required": ["id"] }'
        error={errors.schema?.message}
        {...form.register('schema')}
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
