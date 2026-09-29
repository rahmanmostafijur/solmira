'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { catalogSlugSchema, type Category, type CreateCategoryRequest } from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCreateCategory, useUpdateCategory } from '@/lib/catalog-queries';
import { applyServerError, pickDirty } from '@/lib/forms';
import type { ParentOption } from './category-tree';

const categoryFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(100),
    slug: z.string().trim().toLowerCase(),
    parentId: z.string(),
    description: z.string().trim().max(500),
    sortOrder: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    const slugIssue = values.slug
      ? catalogSlugSchema.safeParse(values.slug).error?.issues[0]?.message
      : undefined;
    if (slugIssue) ctx.addIssue({ code: 'custom', path: ['slug'], message: slugIssue });
    if (!/^\d+$/.test(values.sortOrder) || Number(values.sortOrder) > 10_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['sortOrder'],
        message: 'A whole number from 0 to 10,000',
      });
    }
  });

type FormInput = z.input<typeof categoryFormSchema>;
type FormValues = z.output<typeof categoryFormSchema>;

interface CategoryFormProps {
  organizationId: string;
  category?: Category;
  /** Pre-selected parent when adding a subcategory. */
  parentId?: string;
  parents: readonly ParentOption[];
  onDone: () => void;
}

export function CategoryForm({
  organizationId,
  category,
  parentId,
  parents,
  onDone,
}: CategoryFormProps) {
  const notify = useToast();
  const create = useCreateCategory(organizationId);
  const update = useUpdateCategory(organizationId);
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: category?.name ?? '',
      slug: category?.slug ?? '',
      parentId: category?.parentId ?? parentId ?? '',
      description: category?.description ?? '',
      sortOrder: String(category?.sortOrder ?? 0),
    },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    const request: CreateCategoryRequest = {
      name: values.name,
      parentId: values.parentId || null,
      description: values.description || null,
      sortOrder: Number(values.sortOrder),
      // A blank slug on create lets the server derive one from the name.
      ...(values.slug ? { slug: values.slug } : {}),
    };
    try {
      if (category) {
        const change = pickDirty(request, dirtyFields);
        if (change) await update.mutateAsync({ id: category.id, change });
        notify(change ? 'Category saved' : 'Nothing to save', change ? 'success' : 'info');
      } else {
        await create.mutateAsync(request);
        notify(`Category “${values.name}” created`);
      }
      onDone();
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <TextField
        label="Name"
        autoComplete="off"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label="URL name"
        autoComplete="off"
        hint={category ? undefined : 'Leave empty to derive it from the name'}
        error={errors.slug?.message}
        {...form.register('slug')}
      />
      <SelectField
        label="Parent category"
        hint="Categories can be three levels deep"
        error={errors.parentId?.message}
        {...form.register('parentId')}
      >
        <option value="">None (top level)</option>
        {parents.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label="Description"
        error={errors.description?.message}
        {...form.register('description')}
      />
      <TextField
        label="Sort order"
        inputMode="numeric"
        hint="Lower numbers are listed first"
        error={errors.sortOrder?.message}
        {...form.register('sortOrder')}
      />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {category ? 'Save category' : 'Create category'}
        </Button>
      </div>
    </form>
  );
}
