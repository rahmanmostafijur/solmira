'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { eventTypeNameSchema } from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextAreaField, TextField } from '@/components/ui/field';
import { applyServerError } from '@/lib/forms';
import { parseJsonObject } from '@/lib/json-text';

const formSchema = z.object({
  name: eventTypeNameSchema.refine(
    (name) => !name.startsWith('solmira.'),
    'Names starting with solmira. are reserved for the platform',
  ),
  description: z.string().trim().max(500),
  schema: z.string().refine((text) => text.trim() === '' || 'value' in parseJsonObject(text), {
    message: 'Enter a JSON object, or leave this empty',
  }),
});
type Values = z.infer<typeof formSchema>;

export interface EventTypeSubmission {
  name: string;
  description?: string;
  schema?: Record<string, unknown>;
}

/** Creates an event type: a name such as invoice.paid, and an optional JSON Schema for payloads. */
export function EventTypeForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (values: EventTypeSubmission) => Promise<unknown>;
  onCancel: () => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', description: '', schema: '' },
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
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <TextField
        label="Name"
        placeholder="invoice.paid"
        hint="Lowercase letters, digits, dots, dashes and underscores."
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
        hint="Optional JSON Schema (draft 2020-12). Messages that do not match are rejected."
        placeholder='{ "type": "object", "required": ["id"] }'
        error={errors.schema?.message}
        {...form.register('schema')}
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Create event type
        </Button>
      </div>
    </form>
  );
}
