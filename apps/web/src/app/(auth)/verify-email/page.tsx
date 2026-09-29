'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/auth/auth-card';
import { Alert } from '@/components/ui/feedback';
import { describeError } from '@/lib/api/client';
import { api } from '@/lib/auth/session-store';

type State =
  { status: 'verifying' } | { status: 'verified' } | { status: 'failed'; message: string };

function VerifyEmail() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>({ status: 'verifying' });
  const started = useRef(false);

  useEffect(() => {
    // Tokens are single-use: guard against React strict mode running the effect twice.
    if (!token || started.current) return;
    started.current = true;
    api<void>('/auth/verify-email', { method: 'POST', body: { token }, authenticated: false })
      .then(() => setState({ status: 'verified' }))
      .catch((error: unknown) => setState({ status: 'failed', message: describeError(error) }));
  }, [token]);

  if (!token) {
    return (
      <AuthCard title="Email verification">
        <Alert tone="error">This verification link is incomplete.</Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Email verification">
      {state.status === 'verifying' && (
        <p className="text-sm text-ink-muted" role="status">
          Confirming your email address…
        </p>
      )}
      {state.status === 'verified' && (
        <Alert tone="success" title="Email confirmed">
          Your email address is verified.{' '}
          <Link href="/dashboard" className="font-medium text-accent hover:underline">
            Continue to Solmira
          </Link>
        </Alert>
      )}
      {state.status === 'failed' && <Alert tone="error">{state.message}</Alert>}
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
