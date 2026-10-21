'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { passwordSchema } from '@solmira/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { api } from '@/lib/auth/session-store';
import { applyServerError } from '@/lib/forms';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const [done, setDone] = useState(false);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    try {
      await api<void>('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
        authenticated: false,
      });
      setDone(true);
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  if (!token) {
    return (
      <AuthCard title="Reset your password">
        <Alert tone="error">
          This reset link is incomplete. Request a new one from the sign-in page.
        </Alert>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Signing in with the new password ends all other sessions."
    >
      {done ? (
        <div className="space-y-4">
          <Alert tone="success" title="Password updated">
            All existing sessions were signed out.
          </Alert>
          <Link
            href="/login"
            className="inline-flex text-sm font-medium text-accent hover:underline"
          >
            Sign in with your new password
          </Link>
        </div>
      ) : (
        <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            autoFocus
            error={errors.password?.message}
            {...form.register('password')}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirm?.message}
            {...form.register('confirm')}
          />
          <Button type="submit" loading={isSubmitting} className="w-full">
            Update password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
