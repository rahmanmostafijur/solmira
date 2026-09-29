'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  PAYMENT_TERMS,
  phoneSchema,
  type CreateSupplierRequest,
  type Supplier,
} from '@solmira/contracts';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCreateSupplier, useUpdateSupplier } from '@/lib/catalog-queries';
import { applyServerError, pickDirty } from '@/lib/forms';
import { PAYMENT_TERMS_LABELS } from './labels';

const text = (max: number) => z.string().trim().max(max);

const supplierFormSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Enter the company name').max(200),
    contactName: text(120),
    email: text(254),
    phone: text(40),
    addressLine: text(200),
    city: text(100),
    country: z.string().trim().toUpperCase(),
    paymentTerms: z.enum(PAYMENT_TERMS),
    leadTimeDays: z.string().trim(),
    notes: text(2000),
  })
  .superRefine((values, ctx) => {
    if (values.email && !z.email().safeParse(values.email).success) {
      ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address' });
    }
    const phoneIssue = values.phone
      ? phoneSchema.safeParse(values.phone).error?.issues[0]?.message
      : undefined;
    if (phoneIssue) ctx.addIssue({ code: 'custom', path: ['phone'], message: phoneIssue });
    if (values.country && !/^[A-Z]{2}$/.test(values.country)) {
      ctx.addIssue({
        code: 'custom',
        path: ['country'],
        message: 'Use a 2-letter country code, e.g. BD',
      });
    }
    if (!/^\d+$/.test(values.leadTimeDays) || Number(values.leadTimeDays) > 365) {
      ctx.addIssue({ code: 'custom', path: ['leadTimeDays'], message: 'Whole days from 0 to 365' });
    }
  });

type FormInput = z.input<typeof supplierFormSchema>;
type FormValues = z.output<typeof supplierFormSchema>;

const orNull = (value: string) => (value === '' ? null : value);

function defaults(supplier?: Supplier): FormInput {
  return {
    companyName: supplier?.companyName ?? '',
    contactName: supplier?.contactName ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    addressLine: supplier?.addressLine ?? '',
    city: supplier?.city ?? '',
    country: supplier?.country ?? '',
    paymentTerms: supplier?.paymentTerms ?? 'NET_30',
    leadTimeDays: String(supplier?.leadTimeDays ?? 7),
    notes: supplier?.notes ?? '',
  };
}

function toRequest(values: FormValues): CreateSupplierRequest {
  return {
    companyName: values.companyName,
    contactName: orNull(values.contactName),
    email: orNull(values.email),
    phone: orNull(values.phone),
    addressLine: orNull(values.addressLine),
    city: orNull(values.city),
    country: orNull(values.country),
    paymentTerms: values.paymentTerms,
    leadTimeDays: Number(values.leadTimeDays),
    notes: orNull(values.notes),
  };
}

interface SupplierFormProps {
  organizationId: string;
  supplier?: Supplier;
  readOnly?: boolean;
  onSaved: (supplier: Supplier) => void;
  onCancel?: () => void;
}

export function SupplierForm({
  organizationId,
  supplier,
  readOnly,
  onSaved,
  onCancel,
}: SupplierFormProps) {
  const notify = useToast();
  const create = useCreateSupplier(organizationId);
  const update = useUpdateSupplier(organizationId, supplier?.id ?? '');
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: defaults(supplier),
  });
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (!supplier) {
        onSaved(await create.mutateAsync(toRequest(values)));
        return;
      }
      const change = pickDirty(toRequest(values), dirtyFields);
      if (!change) return notify('Nothing to save', 'info');
      const saved = await update.mutateAsync(change);
      form.reset(defaults(saved));
      onSaved(saved);
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField
            label="Company name"
            autoComplete="organization"
            error={errors.companyName?.message}
            {...form.register('companyName')}
          />
        </div>
        <TextField
          label="Contact person"
          autoComplete="name"
          error={errors.contactName?.message}
          {...form.register('contactName')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label="Phone"
          type="tel"
          autoComplete="tel"
          error={errors.phone?.message}
          {...form.register('phone')}
        />
        <TextField
          label="Country"
          maxLength={2}
          hint="2-letter code, e.g. BD"
          error={errors.country?.message}
          {...form.register('country')}
        />
        <TextField
          label="Address"
          autoComplete="street-address"
          error={errors.addressLine?.message}
          {...form.register('addressLine')}
        />
        <TextField label="City" error={errors.city?.message} {...form.register('city')} />
        <SelectField
          label="Payment terms"
          error={errors.paymentTerms?.message}
          {...form.register('paymentTerms')}
        >
          {PAYMENT_TERMS.map((terms) => (
            <option key={terms} value={terms}>
              {PAYMENT_TERMS_LABELS[terms]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Lead time (days)"
          inputMode="numeric"
          error={errors.leadTimeDays?.message}
          {...form.register('leadTimeDays')}
        />
        <div className="sm:col-span-2">
          <TextAreaField label="Notes" error={errors.notes?.message} {...form.register('notes')} />
        </div>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={isSubmitting} disabled={Boolean(supplier) && !isDirty}>
            {supplier ? 'Save changes' : 'Create supplier'}
          </Button>
        </div>
      )}
    </form>
  );
}
