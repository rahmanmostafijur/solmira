'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { api } from '@/lib/auth/session-store';

function AcceptInvitation() {
  const token = useSearchParams().get('token');
  const { status, session, switchOrganization } = useAuth();
  const router = useRouter();
  const notify = useToast();
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const returnTo = `/accept-invitation?token=${encodeURIComponent(token ?? '')}`;

  if (!token) {
    return (
      <AuthCard title="Invitation">
        <Alert tone="error">This invitation link is incomplete. Ask for a new invitation.</Alert>
      </AuthCard>
    );
  }

  if (status === 'loading') {
    return (
      <AuthCard title="Invitation">
        <p role="status" className="text-sm text-ink-muted">
          Loading…
        </p>
      </AuthCard>
    );
  }

  if (status === 'anonymous') {
    return (
      <AuthCard
        title="You have been invited"
        description="Sign in or create an account with the email address the invitation was sent to."
      >
        <div className="flex flex-col gap-2">
          <Link
            href={`/login?next=${encodeURIComponent(returnTo)}`}
            className="rounded-md bg-accent px-3.5 py-2 text-center text-sm font-medium text-white hover:bg-accent/90"
          >
            Sign in to accept
          </Link>
          <Link
            href={`/register?next=${encodeURIComponent(returnTo)}`}
            className="rounded-md border border-line px-3.5 py-2 text-center text-sm font-medium hover:bg-canvas"
          >
            Create an account
          </Link>
        </div>
      </AuthCard>
    );
  }

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const { organizationId } = await api<{ organizationId: string }>('/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      const next = await switchOrganization(organizationId);
      notify(`Welcome to ${next.activeOrganization?.name ?? 'your new organization'}`);
      router.replace('/dashboard');
    } catch (failure) {
      setError(describeError(failure));
      setAccepting(false);
    }
  };

  return (
    <AuthCard
      title="Join organization"
      description={`You are signed in as ${session?.user.email}.`}
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Button onClick={() => void accept()} loading={accepting} className="w-full">
          Accept invitation
        </Button>
      </div>
    </AuthCard>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
