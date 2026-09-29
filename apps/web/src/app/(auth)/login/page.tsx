'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema, type LoginRequest } from '@solmira/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { applyServerError } from '@/lib/forms';
import { safeNextPath } from '@/lib/routing';

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const form = useForm<z.input<typeof loginRequestSchema>, unknown, LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const session = await login(values);
      // No organization yet: send the user to create or join one.
      router.replace(
        next ? safeNextPath(next) : session.activeOrganization ? '/dashboard' : '/organizations',
      );
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to your workspace."
      footer={
        <>
          New to Solmira?{' '}
          <Link
            href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
            className="font-medium text-accent hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <TextField
          label="Work email"
          type="email"
          autoComplete="email"
          autoFocus
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm text-accent hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
