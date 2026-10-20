'use client';

import type {
  CreateInvitationRequest,
  CreateOrganizationRequest,
  Invitation,
  Member,
  MembershipSummary,
  Organization,
  RoleSummary,
  SessionSummary,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
} from '@solmira/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './auth/session-store';

/**
 * Every tenant-owned query key starts with ['org', organizationId], so data cached for one
 * organization can never be served while another is active.
 */
export const queryKeys = {
  me: ['me'] as const,
  organizations: ['organizations'] as const,
  sessions: ['sessions'] as const,
  organization: (organizationId: string) => ['org', organizationId, 'profile'] as const,
  members: (organizationId: string) => ['org', organizationId, 'members'] as const,
  invitations: (organizationId: string) => ['org', organizationId, 'invitations'] as const,
  roles: (organizationId: string) => ['org', organizationId, 'roles'] as const,
};

export const useOrganizations = () =>
  useQuery({
    queryKey: queryKeys.organizations,
    queryFn: () => api<MembershipSummary[]>('/organizations'),
  });

export const useSessions = () =>
  useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api<SessionSummary[]>('/auth/sessions'),
  });

export const useOrganization = (organizationId: string) =>
  useQuery({
    queryKey: queryKeys.organization(organizationId),
    queryFn: () => api<Organization>(`/organizations/${organizationId}`),
  });

export const useMembers = (organizationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.members(organizationId),
    queryFn: () => api<Member[]>(`/organizations/${organizationId}/members`),
    enabled,
  });

export const useInvitations = (organizationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.invitations(organizationId),
    queryFn: () => api<Invitation[]>(`/organizations/${organizationId}/invitations`),
    enabled,
  });

export const useRoles = (organizationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.roles(organizationId),
    queryFn: () => api<RoleSummary[]>('/roles'),
    enabled,
  });

export function useCreateOrganization() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOrganizationRequest) =>
      api<Organization>('/organizations', { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.organizations }),
  });
}

export function useUpdateOrganization(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOrganizationRequest) =>
      api<Organization>(`/organizations/${organizationId}`, { method: 'PATCH', body }),
    onSuccess: (organization) => {
      client.setQueryData(queryKeys.organization(organizationId), organization);
      void client.invalidateQueries({ queryKey: queryKeys.organizations });
    },
  });
}

export function useUpdateMember(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, change }: { memberId: string; change: UpdateMemberRequest }) =>
      api<Member>(`/organizations/${organizationId}/members/${memberId}`, {
        method: 'PATCH',
        body: change,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.members(organizationId) }),
  });
}

export function useRemoveMember(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      api<void>(`/organizations/${organizationId}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.members(organizationId) }),
  });
}

export function useInvite(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvitationRequest) =>
      api<Invitation>(`/organizations/${organizationId}/invitations`, { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.invitations(organizationId) }),
  });
}

export function useRevokeInvitation(organizationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      api<void>(`/organizations/${organizationId}/invitations/${invitationId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.invitations(organizationId) }),
  });
}

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api<void>(`/auth/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.sessions }),
  });
}
