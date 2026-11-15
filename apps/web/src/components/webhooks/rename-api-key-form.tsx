'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { updateApiKeyRequestSchema, type UpdateApiKeyRequest } from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { applyServerError } from '@/lib/forms';

/** Renames an API key. Only the name changes: scopes and expiry are fixed at creation. */
export function RenameApiKeyForm({
  name,
  onSubmit,
  onCancel,
}: {
  name: string;
  onSubmit: (values: UpdateApiKeyRequest) => Promise<unknown>;
  onCancel: () => void;
}) {
  const form = useForm<UpdateApiKeyRequest>({
    resolver: zodResolver(updateApiKeyRequestSchema),
    defaultValues: { name },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <TextField label="Name" error={errors.name?.message} {...form.register('name')} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Rename
        </Button>
      </div>
    </form>
  );
}
