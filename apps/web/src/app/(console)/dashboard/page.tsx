'use client';

import clsx from 'clsx';
import { Check, Minus, MonitorSmartphone } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { usePermissions } from '@/components/auth/can';
import { permissionGroups } from '@/components/access/permission-groups';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { RoleBadge } from '@/components/ui/role-badge';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useRevokeSession, useSessions } from '@/lib/queries';

function AccessSummary() {
  const { can } = usePermissions();
  return (
    <Panel title="Your access" description="What your role allows in this organization.">
      <ul className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {permissionGroups().map((group) => (
          <li key={group.area}>
            <p className="text-sm font-medium">{group.label}</p>
            <ul className="mt-1.5 space-y-1">
              {group.permissions.map((permission) => {
                const granted = can(permission.key);
                return (
                  <li
                    key={permission.key}
                    className={clsx(
                      'flex items-start gap-2 text-xs',
                      granted ? 'text-ink' : 'text-ink-muted/70',
                    )}
                  >
                    {granted ? (
                      <Check aria-label="Allowed" className="mt-px size-3.5 text-ok" />
                    ) : (
                      <Minus aria-label="Not allowed" className="mt-px size-3.5" />
                    )}
                    {permission.description}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SessionsPanel() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const notify = useToast();

  return (
    <Panel title="Signed-in devices" description="Sign out devices you no longer use.">
      {sessions.isPending ? (
        <LoadingRows rows={2} label="Loading sessions" />
      ) : sessions.isError ? (
        <div className="p-5">
          <Alert tone="error">{describeError(sessions.error)}</Alert>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {sessions.data.map((session) => (
            <li key={session.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <MonitorSmartphone aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate">{session.userAgent ?? 'Unknown device'}</p>
                <p className="text-xs text-ink-muted">
                  Last active {new Date(session.lastSeenAt).toLocaleString()}
                </p>
              </div>
              {session.current ? (
                <span className="text-xs font-medium text-ok">This device</span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={revoke.isPending && revoke.variables === session.id}
                  onClick={() =>
                    revoke.mutate(session.id, {
                      onSuccess: () => notify('Device signed out'),
                      onError: (error) => notify(describeError(error), 'error'),
                    })
                  }
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function DashboardPage() {
  const { session } = useAuth();
  const { organization } = usePermissions();
  if (!session) return null;
  const firstName = session.user.fullName.split(' ')[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={
          organization
            ? `You are working in ${organization.name}.`
            : 'You are not part of an organization yet.'
        }
      />

      {!session.user.emailVerified && (
        <Alert tone="warning" title="Confirm your email address">
          We sent a confirmation link to {session.user.email}.
        </Alert>
      )}

      {organization ? (
        <>
          <Panel>
            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="grid size-10 place-items-center rounded-lg bg-accent-soft font-semibold text-accent">
                {organization.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{organization.name}</p>
                <p className="text-xs text-ink-muted">solmira.app/{organization.slug}</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                Your role <RoleBadge role={organization.role} />
              </div>
            </div>
          </Panel>
          <AccessSummary />
        </>
      ) : (
        <Panel>
          <EmptyState
            title="Create or join an organization"
            description="Organizations hold your applications, endpoints and messages. Create one, or ask a colleague to invite you."
            action={
              <Link
                href="/organizations"
                className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/90"
              >
                Set up an organization
              </Link>
            }
          />
        </Panel>
      )}

      <SessionsPanel />
    </div>
  );
}
