'use client';

import type { Permission } from '@solmira/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/feedback';
import { usePermissions } from './can';

type ActiveOrganization = NonNullable<ReturnType<typeof usePermissions>['organization']>;

/**
 * Renders its children only with an active organization that grants `permission`. This shapes
 * the page; the API is what actually refuses a request without the permission.
 */
export function RequireOrganization({
  permission,
  children,
}: {
  permission: Permission;
  children: (organization: ActiveOrganization) => ReactNode;
}) {
  const { organization, can } = usePermissions();
  if (!organization) {
    return (
      <Alert tone="info" title="No organization selected">
        <Link href="/organizations" className="font-medium text-accent hover:underline">
          Choose or create an organization
        </Link>{' '}
        to work with its applications.
      </Alert>
    );
  }
  if (!can(permission)) {
    return (
      <Alert tone="warning" title="You do not have access to this page">
        Your role in {organization.name} does not include it. Ask an owner or admin if you need it.
      </Alert>
    );
  }
  return <>{children(organization)}</>;
}
