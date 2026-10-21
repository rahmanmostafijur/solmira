'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { AttemptTimeline } from '@/components/webhooks/attempt-timeline';
import { STATUS_LABELS, STATUS_TONES } from '@/components/webhooks/delivery-status';
import { describeError } from '@/lib/api/client';
import { prettyJson } from '@/lib/json-text';
import { useMessage, useReplayMessage } from '@/lib/webhook-queries';

function MessageInspector({
  organizationId,
  applicationId,
  messageId,
}: {
  organizationId: string;
  applicationId: string;
  messageId: string;
}) {
  const { can } = usePermissions();
  const notify = useToast();
  const message = useMessage(organizationId, applicationId, messageId);
  const replay = useReplayMessage(organizationId, applicationId, messageId);

  if (message.isPending) return <LoadingRows label="Loading message" />;
  if (message.isError) return <Alert tone="error">{describeError(message.error)}</Alert>;
  const { data } = message;

  const replayDelivery = (endpointId?: string) =>
    replay.mutate(endpointId, {
      onSuccess: (result) =>
        notify(result.replayed > 0 ? 'Queued for another delivery' : 'Nothing to replay'),
      onError: (error) => notify(describeError(error), 'error'),
    });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={data.eventType}
        description={`Message ${data.id} · ${new Date(data.createdAt).toLocaleString()}`}
        actions={
          <div className="flex items-center gap-4">
            <Link
              href={`/applications/${applicationId}/messages`}
              className="text-sm font-medium text-accent hover:underline"
            >
              All messages
            </Link>
            {can('deliveries.replay') && data.deliveries.length > 0 && (
              <Button onClick={() => replayDelivery()} loading={replay.isPending}>
                Replay to all endpoints
              </Button>
            )}
          </div>
        }
      />
      <Panel title="Payload" description={`Idempotency key: ${data.idempotencyKey}`}>
        <pre className="max-h-96 overflow-auto p-5 font-mono text-xs">
          {prettyJson(data.payload)}
        </pre>
      </Panel>
      {!data.attemptsAvailable && (
        <Alert tone="warning" title="Attempt history is unavailable">
          Deliveries are unaffected. The timeline will return when the history store recovers.
        </Alert>
      )}
      {data.deliveries.length === 0 && (
        <Alert tone="info">
          No endpoint subscribed to this event type, so nothing was delivered.
        </Alert>
      )}
      {data.deliveries.map((delivery) => (
        <Panel
          key={delivery.id}
          title={delivery.endpointUrl}
          actions={
            <div className="flex items-center gap-3">
              <Badge tone={STATUS_TONES[delivery.status]}>{STATUS_LABELS[delivery.status]}</Badge>
              {can('deliveries.replay') && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={replay.isPending}
                  onClick={() => replayDelivery(delivery.endpointId)}
                >
                  Replay
                </Button>
              )}
            </div>
          }
        >
          <div className="p-5">
            <AttemptTimeline
              attempts={data.attempts.filter((attempt) => attempt.deliveryId === delivery.id)}
            />
          </div>
        </Panel>
      ))}
    </div>
  );
}

export default function MessagePage() {
  const { applicationId, messageId } = useParams<{ applicationId: string; messageId: string }>();
  return (
    <RequireOrganization permission="messages.read">
      {(organization) => (
        <MessageInspector
          organizationId={organization.id}
          applicationId={applicationId}
          messageId={messageId}
        />
      )}
    </RequireOrganization>
  );
}
