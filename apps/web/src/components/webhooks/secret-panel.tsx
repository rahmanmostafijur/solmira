'use client';

import { DEFAULT_ROTATION_WINDOW_HOURS } from '@solmira/contracts';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, Panel } from '@/components/ui/feedback';
import { SecretDisplay } from '@/components/ui/secret-display';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useRevealSecret, useRotateSecret } from '@/lib/webhook-queries';

/** Reveal and rotate the signing secret. Both are audited on the server and need elevated roles. */
export function SecretPanel({
  applicationId,
  endpointId,
}: {
  applicationId: string;
  endpointId: string;
}) {
  const { can } = usePermissions();
  const notify = useToast();
  const reveal = useRevealSecret(applicationId, endpointId);
  const rotate = useRotateSecret(applicationId, endpointId);
  const [shown, setShown] = useState<{ label: string; value: string }>();
  const [confirming, setConfirming] = useState(false);

  if (!can('endpoint_secrets.reveal') && !can('endpoint_secrets.rotate')) return null;

  return (
    <Panel
      title="Signing secret"
      description="Receivers use it to verify the signature on every delivery."
    >
      <div className="space-y-4 p-5">
        {shown && (
          <>
            <SecretDisplay label={shown.label} value={shown.value} />
            <Button variant="ghost" size="sm" onClick={() => setShown(undefined)}>
              Hide
            </Button>
          </>
        )}
        {reveal.isError && <Alert tone="error">{describeError(reveal.error)}</Alert>}
        {rotate.isError && <Alert tone="error">{describeError(rotate.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          {can('endpoint_secrets.reveal') && (
            <Button
              variant="secondary"
              loading={reveal.isPending}
              onClick={() =>
                reveal.mutate(undefined, {
                  onSuccess: (result) =>
                    setShown({ label: 'Signing secret', value: result.secret }),
                })
              }
            >
              Reveal secret
            </Button>
          )}
          {can('endpoint_secrets.rotate') && (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Rotate secret
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        tone="primary"
        title="Rotate the signing secret?"
        description={`A new secret is created. Both secrets sign deliveries for ${DEFAULT_ROTATION_WINDOW_HOURS} hours so receivers can switch without downtime.`}
        confirmLabel="Rotate"
        pending={rotate.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          rotate.mutate(
            { windowHours: DEFAULT_ROTATION_WINDOW_HOURS },
            {
              onSuccess: (result) => {
                setConfirming(false);
                setShown({ label: 'New signing secret', value: result.secret });
                notify('Secret rotated');
              },
              onError: () => setConfirming(false),
            },
          )
        }
      />
    </Panel>
  );
}
