'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createApplicationRequestSchema, type Application } from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { applyServerError } from '@/lib/forms';

type Values = z.input<typeof createApplicationRequestSchema>;

/** Name and description of an application (an app or environment such as production). */
export function ApplicationForm({
  onSubmit,
  onCancel,
  initial,
  submitLabel = 'Create application',
}: {
  onSubmit: (values: { name: string; description?: string }) => Promise<unknown>;
  onCancel: () => void;
  initial?: Pick<Application, 'name' | 'description'>;
  submitLabel?: string;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(createApplicationRequestSchema),
    defaultValues: { name: initial?.name ?? '', description: initial?.description ?? '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit({
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
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
        placeholder="Production"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label="Description"
        hint="Optional"
        error={errors.description?.message}
        {...form.register('description')}
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
