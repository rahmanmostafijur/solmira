'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createOrganizationRequestSchema,
  type CreateOrganizationRequest,
} from '@solmira/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { RoleBadge } from '@/components/ui/role-badge';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { applyServerError } from '@/lib/forms';
import { useCreateOrganization, useOrganizations } from '@/lib/queries';

function CreateOrganization() {
  const create = useCreateOrganization();
  const { switchOrganization } = useAuth();
  const router = useRouter();
  const notify = useToast();
  const form = useForm<
    z.input<typeof createOrganizationRequestSchema>,
    unknown,
    CreateOrganizationRequest
  >({
    resolver: zodResolver(createOrganizationRequestSchema),
    defaultValues: { name: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const organization = await create.mutateAsync({
        name: values.name,
        ...(values.slug ? { slug: values.slug } : {}),
      });
      await switchOrganization(organization.id);
      notify(`${organization.name} is ready`);
      router.push('/dashboard');
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <Panel
      title="Create an organization"
      description="You will be its owner and can invite your team afterwards."
    >
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        {errors.root && (
          <div className="sm:col-span-3">
            <Alert tone="error">{errors.root.message}</Alert>
          </div>
        )}
        <TextField
          label="Organization name"
          autoComplete="organization"
          placeholder="Northwind Traders"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label="URL name (optional)"
          autoComplete="off"
          placeholder="northwind-traders"
          error={errors.slug?.message}
          {...form.register('slug', { setValueAs: (value: string) => value || undefined })}
        />
        <Button type="submit" loading={isSubmitting}>
          Create
        </Button>
      </form>
    </Panel>
  );
}

export default function OrganizationsPage() {
  const organizations = useOrganizations();
  const { session, switchOrganization } = useAuth();
  const router = useRouter();
  const notify = useToast();
  const [switching, setSwitching] = useState<string | null>(null);
  const activeId = session?.activeOrganization?.id;

  const switchTo = async (organizationId: string) => {
    setSwitching(organizationId);
    try {
      await switchOrganization(organizationId);
      router.push('/dashboard');
    } catch (error) {
      notify(describeError(error), 'error');
      setSwitching(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Organizations"
        description="Every organization keeps its own data, members and settings."
      />

      <Panel title="Your organizations">
        {organizations.isPending ? (
          <LoadingRows label="Loading organizations" />
        ) : organizations.isError ? (
          <div className="p-5">
            <Alert tone="error">{describeError(organizations.error)}</Alert>
          </div>
        ) : organizations.data.length === 0 ? (
          <EmptyState
            title="No organizations yet"
            description="Create one below, or accept an invitation from a colleague."
          />
        ) : (
          <ul className="divide-y divide-line">
            {organizations.data.map((membership) => {
              const { organization } = membership;
              const isActive = organization.id === activeId;
              return (
                <li key={organization.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{organization.name}</p>
                    <p className="text-xs text-ink-muted">{organization.slug}</p>
                  </div>
                  <RoleBadge role={membership.role} />
                  {membership.status !== 'active' ? (
                    <span className="w-24 text-right text-xs text-ink-muted">Suspended</span>
                  ) : isActive ? (
                    <span className="w-24 text-right text-xs font-medium text-ok">Current</span>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-24"
                      loading={switching === organization.id}
                      onClick={() => void switchTo(organization.id)}
                    >
                      Switch
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <CreateOrganization />
    </div>
  );
}
