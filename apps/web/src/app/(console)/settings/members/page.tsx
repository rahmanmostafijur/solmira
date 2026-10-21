'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ROLE_DEFINITIONS,
  assignableRoles,
  canManageMember,
  createInvitationRequestSchema,
  type CreateInvitationRequest,
  type Member,
  type RoleKey,
} from '@solmira/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useAuth } from '@/components/auth/auth-provider';
import { Can, usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { SelectField, TextField } from '@/components/ui/field';
import { RoleBadge } from '@/components/ui/role-badge';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { applyServerError } from '@/lib/forms';
import {
  useInvitations,
  useInvite,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateMember,
} from '@/lib/queries';

function InviteForm({ organizationId, actorRole }: { organizationId: string; actorRole: RoleKey }) {
  const invite = useInvite(organizationId);
  const notify = useToast();
  const roles = assignableRoles(actorRole);
  const form = useForm<
    z.input<typeof createInvitationRequestSchema>,
    unknown,
    CreateInvitationRequest
  >({
    resolver: zodResolver(createInvitationRequestSchema),
    defaultValues: { email: '', role: roles.includes('STAFF') ? 'STAFF' : roles[roles.length - 1] },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await invite.mutateAsync(values);
      notify(`Invitation sent to ${values.email}`);
      form.reset({ email: '', role: values.role });
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <Panel title="Invite people" description="They receive an email link that expires in 7 days.">
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid gap-4 p-5 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
      >
        {errors.root && (
          <div className="sm:col-span-3">
            <Alert tone="error">{errors.root.message}</Alert>
          </div>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          placeholder="colleague@company.com"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <SelectField label="Role" error={errors.role?.message} {...form.register('role')}>
          {roles.map((role) => (
            <option key={role} value={role}>
              {ROLE_DEFINITIONS[role].name}
            </option>
          ))}
        </SelectField>
        <Button type="submit" loading={isSubmitting}>
          Send invitation
        </Button>
      </form>
    </Panel>
  );
}

type PendingAction = { kind: 'remove' | 'suspend'; member: Member } | null;

function MembersTable({
  organizationId,
  actorRole,
}: {
  organizationId: string;
  actorRole: RoleKey;
}) {
  const { session } = useAuth();
  const { can } = usePermissions();
  const members = useMembers(organizationId);
  const updateMember = useUpdateMember(organizationId);
  const removeMember = useRemoveMember(organizationId);
  const notify = useToast();
  const [pending, setPending] = useState<PendingAction>(null);

  const changeRole = (member: Member, role: RoleKey) =>
    updateMember.mutate(
      { memberId: member.id, change: { role } },
      {
        onSuccess: () => notify(`${member.fullName} is now ${ROLE_DEFINITIONS[role].name}`),
        onError: (error) => notify(describeError(error), 'error'),
      },
    );

  const confirm = () => {
    if (!pending) return;
    const { member, kind } = pending;
    const done = {
      onSettled: () => setPending(null),
      onError: (error: unknown) => notify(describeError(error), 'error'),
    };
    if (kind === 'remove') {
      removeMember.mutate(member.id, {
        ...done,
        onSuccess: () => notify(`${member.fullName} was removed`),
      });
    } else {
      updateMember.mutate(
        { memberId: member.id, change: { status: 'suspended' } },
        { ...done, onSuccess: () => notify(`${member.fullName} was suspended`) },
      );
    }
  };

  if (members.isPending) return <LoadingRows label="Loading members" />;
  if (members.isError) return <Alert tone="error">{describeError(members.error)}</Alert>;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">Organization members</caption>
          <thead className="border-b border-line bg-canvas text-left text-[11px] tracking-wider text-ink-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">
                Member
              </th>
              <th scope="col" className="px-5 py-2.5 font-medium">
                Role
              </th>
              <th scope="col" className="px-5 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.data.map((member) => {
              const isSelf = member.userId === session?.user.id;
              // UI mirror of the server's rules; the API re-checks every one of them.
              const manageable = !isSelf && canManageMember(actorRole, member.role);
              const roleEditable = manageable && can('roles.assign');
              return (
                <tr key={member.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium">
                      {member.fullName}{' '}
                      {isSelf && <span className="text-xs font-normal text-ink-muted">(you)</span>}
                    </p>
                    <p className="text-xs text-ink-muted">{member.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    {roleEditable ? (
                      <select
                        name={`role-${member.id}`}
                        aria-label={`Role for ${member.fullName}`}
                        value={member.role}
                        onChange={(event) => changeRole(member, event.target.value as RoleKey)}
                        className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
                      >
                        {[...new Set([member.role, ...assignableRoles(actorRole)])].map((role) => (
                          <option key={role} value={role}>
                            {ROLE_DEFINITIONS[role].name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={member.status === 'active' ? 'text-ok' : 'text-warn'}>
                      {member.status === 'active' ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      {manageable &&
                        can('users.update') &&
                        (member.status === 'active' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setPending({ kind: 'suspend', member })}
                          >
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              updateMember.mutate(
                                { memberId: member.id, change: { status: 'active' } },
                                {
                                  onSuccess: () => notify(`${member.fullName} was reactivated`),
                                  onError: (e) => notify(describeError(e), 'error'),
                                },
                              )
                            }
                          >
                            Reactivate
                          </Button>
                        ))}
                      {manageable && can('users.delete') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger"
                          onClick={() => setPending({ kind: 'remove', member })}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'remove'
            ? `Remove ${pending.member.fullName}?`
            : `Suspend ${pending?.member.fullName}?`
        }
        description={
          pending?.kind === 'remove'
            ? 'They lose access immediately. You can invite them again later.'
            : 'They lose access immediately but keep their account. You can reactivate them at any time.'
        }
        confirmLabel={pending?.kind === 'remove' ? 'Remove member' : 'Suspend member'}
        pending={removeMember.isPending || updateMember.isPending}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

function PendingInvitations({ organizationId }: { organizationId: string }) {
  const invitations = useInvitations(organizationId);
  const revoke = useRevokeInvitation(organizationId);
  const notify = useToast();

  if (invitations.isPending) return <LoadingRows rows={1} label="Loading invitations" />;
  if (invitations.isError) return <Alert tone="error">{describeError(invitations.error)}</Alert>;
  if (invitations.data.length === 0) return <EmptyState title="No pending invitations" />;

  return (
    <ul className="divide-y divide-line">
      {invitations.data.map((invitation) => (
        <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate">{invitation.email}</p>
            <p className="text-xs text-ink-muted">
              Expires {new Date(invitation.expiresAt).toLocaleDateString()}
            </p>
          </div>
          <RoleBadge role={invitation.role} />
          <Can permission="users.create">
            <Button
              variant="ghost"
              size="sm"
              loading={revoke.isPending && revoke.variables === invitation.id}
              onClick={() =>
                revoke.mutate(invitation.id, {
                  onSuccess: () => notify('Invitation revoked'),
                  onError: (error) => notify(describeError(error), 'error'),
                })
              }
            >
              Revoke
            </Button>
          </Can>
        </li>
      ))}
    </ul>
  );
}

export default function MembersPage() {
  const { organization, can } = usePermissions();
  if (!organization) return null;
  if (!can('users.read')) {
    return <Alert tone="info">Your role cannot view the member list of this organization.</Alert>;
  }

  return (
    <div className="space-y-6">
      <Can permission="users.create">
        <InviteForm organizationId={organization.id} actorRole={organization.role} />
      </Can>
      <Panel title="Members">
        <MembersTable organizationId={organization.id} actorRole={organization.role} />
      </Panel>
      <Panel title="Pending invitations">
        <PendingInvitations organizationId={organization.id} />
      </Panel>
    </div>
  );
}
