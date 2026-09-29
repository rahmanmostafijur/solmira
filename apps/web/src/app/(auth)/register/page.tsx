'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  type RegisterRequest,
} from '@solmira/contracts';
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

function RegisterForm() {
  const { register: createAccount } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const form = useForm<z.input<typeof registerRequestSchema>, unknown, RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { fullName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createAccount(values);
      router.replace(next ? safeNextPath(next) : '/organizations');
    } catch (error) {
      applyServerError(error, form.setError);
    }
  });

  return (
    <AuthCard
      title="Create your account"
      description="You can create an organization or join one after signing up."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className="font-medium text-accent hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <TextField
          label="Full name"
          autoComplete="name"
          autoFocus
          error={errors.fullName?.message}
          {...form.register('fullName')}
        />
        <TextField
          label="Work email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence works well.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" loading={isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
