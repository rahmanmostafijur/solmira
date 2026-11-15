'use client';

import { Button, type ButtonProps } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError, describeError } from '@/lib/api/client';
import { useRestoreEndpoint } from '@/lib/webhook-queries';

/**
 * Why a restore failed. The URL is checked against the URL policy again on restore, and a URL
 * that no longer passes (a private address, say) keeps the endpoint archived.
 */
export function describeRestoreError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
    const url = error.details.find((detail) => detail.path === 'url');
    if (url) return `This endpoint stays archived: its URL is no longer allowed. ${url.message}`;
  }
  return describeError(error);
}

/** Restores an archived endpoint; it keeps its URL, subscriptions and enabled flag. */
export function RestoreEndpointButton({
  organizationId,
  applicationId,
  endpointId,
  variant = 'ghost',
  size = 'sm',
  label,
}: {
  organizationId: string;
  applicationId: string;
  endpointId: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  /** Accessible name when several restore buttons share a page. */
  label?: string;
}) {
  const restore = useRestoreEndpoint(organizationId, applicationId);
  const notify = useToast();
  return (
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      loading={restore.isPending}
      onClick={() =>
        restore.mutate(endpointId, {
          onSuccess: () => notify('Endpoint restored'),
          onError: (error) => notify(describeRestoreError(error), 'error'),
        })
      }
    >
      Restore
    </Button>
  );
}
