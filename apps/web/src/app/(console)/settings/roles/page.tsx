'use client';

import clsx from 'clsx';
import { Check } from 'lucide-react';
import { Fragment } from 'react';
import { usePermissions } from '@/components/auth/can';
import { permissionGroups } from '@/components/access/permission-groups';
import { Alert, LoadingRows, Panel } from '@/components/ui/feedback';
import { describeError } from '@/lib/api/client';
import { useRoles } from '@/lib/queries';

export default function RolesPage() {
  const { organization, can } = usePermissions();
  const allowed = can('roles.read');
  const roles = useRoles(organization?.id ?? 'none', Boolean(organization) && allowed);

  if (!organization) return null;
  if (!allowed) return <Alert tone="info">Your role cannot view role definitions.</Alert>;
  if (roles.isPending) return <LoadingRows label="Loading roles" />;
  if (roles.isError) return <Alert tone="error">{describeError(roles.error)}</Alert>;

  return (
    <Panel
      title="Roles and permissions"
      description="Roles are fixed bundles of permissions. Every API request is checked against them."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">Permissions granted to each role</caption>
          <thead className="border-b border-line bg-canvas">
            <tr>
              <th
                scope="col"
                className="px-5 py-3 text-left text-[11px] font-medium tracking-wider text-ink-muted uppercase"
              >
                Permission
              </th>
              {roles.data.map((role) => (
                <th
                  key={role.key}
                  scope="col"
                  className={clsx(
                    'px-3 py-3 text-center text-xs font-semibold',
                    role.key === organization.role && 'bg-accent-soft text-accent',
                  )}
                  title={role.description}
                >
                  {role.name}
                  {role.key === organization.role && (
                    <span className="block text-[10px] font-normal">Your role</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissionGroups().map((group) => (
              <Fragment key={group.area}>
                <tr className="border-t border-line">
                  <th
                    colSpan={roles.data.length + 1}
                    scope="colgroup"
                    className="bg-canvas/50 px-5 py-2 text-left text-xs font-semibold"
                  >
                    {group.label}
                  </th>
                </tr>
                {group.permissions.map((permission) => (
                  <tr key={permission.key} className="border-t border-line/60">
                    <th scope="row" className="px-5 py-2 text-left font-normal">
                      <span className="block">{permission.description}</span>
                      <code className="text-[11px] text-ink-muted">{permission.key}</code>
                    </th>
                    {roles.data.map((role) => {
                      const granted = role.permissions.includes(permission.key);
                      return (
                        <td
                          key={role.key}
                          className={clsx(
                            'px-3 py-2 text-center',
                            role.key === organization.role && 'bg-accent-soft/40',
                          )}
                        >
                          {granted ? (
                            <Check aria-label="Granted" className="mx-auto size-4 text-ok" />
                          ) : (
                            <span className="sr-only">Not granted</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
