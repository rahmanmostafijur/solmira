'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { Organization } from '@solmira/contracts';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth/auth-provider';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Alert, LoadingRows, Panel } from '@/components/ui/feedback';
import { SelectField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { applyServerError } from '@/lib/forms';
import { useOrganization, useUpdateOrganization } from '@/lib/queries';

const formSchema = z.object({
  name: z.string().trim().min(2, 'Use at least 2 characters').max(100),
  timezone: z.string().min(1),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code'),
});
type FormValues = z.infer<typeof formSchema>;

function SettingsForm({ organization }: { organization: Organization }) {
  const { can } = usePermissions();
  const { reload } = useAuth();
  const update = useUpdateOrganization(organization.id);
  const notify = useToast();
  const editable = can('organizations.update');
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: organization.name,
      timezone: organization.timezone,
      currency: organization.currency,
    },
  });
  const { errors, isSubmitting, isDirty } = form.formState;

  useEffect(() => {
    form.reset({
      name: organization.name,
      timezone: organization.timezone,
      currency: organization.currency,
    });
  }, [organization, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
      // The active organization's name also lives in the session; pick up the change.
      await reload();
      notify('Settings saved');
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Panel
      title="General"
      description="Name, time zone and default currency for reports and documents."
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4 p-5">
        {!editable && (
          <Alert tone="info">Only owners and administrators can change these settings.</Alert>
        )}
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              label="Organization name"
              autoComplete="organization"
              error={errors.name?.message}
              {...form.register('name')}
            />
          </div>
          <SelectField
            label="Time zone"
            error={errors.timezone?.message}
            {...form.register('timezone')}
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Currency"
            autoComplete="off"
            maxLength={3}
            error={errors.currency?.message}
            {...form.register('currency')}
          />
        </fieldset>
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

export default function GeneralSettingsPage() {
  const { organization } = usePermissions();
  const query = useOrganization(organization!.id);

  if (query.isPending) return <LoadingRows label="Loading settings" />;
  if (query.isError) return <Alert tone="error">{describeError(query.error)}</Alert>;
  return <SettingsForm organization={query.data} />;
}
