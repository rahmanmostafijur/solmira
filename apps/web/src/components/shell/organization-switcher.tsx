'use client';

import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { DropdownMenu, MenuItem } from '@/components/ui/dropdown-menu';
import { RoleBadge } from '@/components/ui/role-badge';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useOrganizations } from '@/lib/queries';

/**
 * Switching asks the backend for a token scoped to the chosen organization. The id sent is only a
 * request: the server re-checks membership and answers 404 if there is none.
 */
export function OrganizationSwitcher() {
  const { session, switchOrganization } = useAuth();
  const organizations = useOrganizations();
  const notify = useToast();
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);
  const active = session?.activeOrganization ?? null;

  const choose = async (organizationId: string, close: () => void) => {
    close();
    if (organizationId === active?.id) return;
    setSwitching(organizationId);
    try {
      const next = await switchOrganization(organizationId);
      notify(`Switched to ${next.activeOrganization?.name ?? 'organization'}`);
      router.push('/dashboard');
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setSwitching(null);
    }
  };

  return (
    <DropdownMenu
      label="Switch organization"
      align="left"
      trigger={
        <>
          <Building2 aria-hidden className="size-4 text-ink-muted" />
          <span className="max-w-40 truncate font-medium">{active?.name ?? 'No organization'}</span>
          <ChevronsUpDown aria-hidden className="size-3.5 text-ink-muted" />
        </>
      }
      header={
        <p className="px-3 pt-1.5 pb-1 text-[11px] font-medium tracking-wider text-ink-muted uppercase">
          Organizations
        </p>
      }
    >
      {(close) => (
        <>
          {organizations.isPending && <p className="px-3 py-2 text-sm text-ink-muted">Loading…</p>}
          {organizations.data?.map((membership) => {
            const isActive = membership.organization.id === active?.id;
            const suspended = membership.status !== 'active';
            return (
              <MenuItem
                key={membership.organization.id}
                disabled={suspended || switching !== null}
                onSelect={() => void choose(membership.organization.id, close)}
              >
                <span className="flex size-4 items-center">
                  {isActive && <Check aria-hidden className="size-4 text-accent" />}
                </span>
                <span className="flex-1 truncate">{membership.organization.name}</span>
                {suspended ? (
                  <span className="text-xs text-ink-muted">Suspended</span>
                ) : (
                  <RoleBadge role={membership.role} />
                )}
              </MenuItem>
            );
          })}
          <div className="my-1 border-t border-line" />
          <MenuItem
            onSelect={() => {
              close();
              router.push('/organizations');
            }}
          >
            <Plus aria-hidden className="size-4 text-ink-muted" />
            Create or manage organizations
          </MenuItem>
        </>
      )}
    </DropdownMenu>
  );
}
