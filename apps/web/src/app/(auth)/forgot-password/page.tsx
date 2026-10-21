'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordRequestSchema } from '@solmira/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { AuthCard } from '@/components/auth/auth-card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { api } from '@/lib/auth/session-store';
import { applyServerError } from '@/lib/forms';

type ForgotPassword = z.output<typeof forgotPasswordRequestSchema>;

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordRequestSchema>, unknown, ForgotPassword>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api<void>('/auth/forgot-password', {
        method: 'POST',
        body: values,
        authenticated: false,
      });
      setSentTo(values.email);
    } catch (error) {
      applyServerError(error, form);
    }
  });

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send you a link to choose a new password."
      footer={
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sentTo ? (
        // Same message whether or not the account exists, so this page cannot reveal who has an account.
        <Alert tone="success" title="Check your inbox">
          If an account exists for {sentTo}, a reset link is on its way. It expires in 30 minutes.
        </Alert>
      ) : (
        <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          <TextField
            label="Work email"
            type="email"
            autoComplete="email"
            autoFocus
            error={errors.email?.message}
            {...form.register('email')}
          />
          <Button type="submit" loading={isSubmitting} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
