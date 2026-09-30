'use client';

import { useAuth } from '@/components/auth/auth-provider';
import { usePermissions } from '@/components/auth/can';
import { useMembers } from '@/lib/queries';

/**
 * Orders record who acted by user id. This names them: "You" for the viewer, the member's name
 * when the viewer may list members, and a neutral phrase otherwise.
 */
export function usePersonName(organizationId: string): (userId: string | null) => string {
  const { session } = useAuth();
  const { can } = usePermissions();
  const members = useMembers(organizationId, can('users.read'));
  const me = session?.user.id ?? null;
  return (userId) => {
    if (!userId) return 'Someone';
    if (userId === me) return 'You';
    return members.data?.find((m) => m.userId === userId)?.fullName ?? 'A team member';
  };
}
