'use client';

import { hasPermissions, type Permission } from '@solmira/contracts';
import type { ReactNode } from 'react';
import { useAuth } from './auth-provider';

/**
 * Permissions of the active organization, from the current session. Used only to shape the UI:
 * hiding a button is a courtesy, the API enforces the rule.
 */
export function usePermissions() {
  const { session } = useAuth();
  const organization = session?.activeOrganization ?? null;
  const granted = organization?.permissions ?? [];
  return {
    organization,
    role: organization?.role ?? null,
    can: (...required: Permission[]) => hasPermissions(granted, required),
  };
}

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission | Permission[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePermissions();
  const required = Array.isArray(permission) ? permission : [permission];
  return <>{can(...required) ? children : fallback}</>;
}
