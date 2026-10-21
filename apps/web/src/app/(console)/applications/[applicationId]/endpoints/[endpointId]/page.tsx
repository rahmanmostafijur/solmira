'use client';

import { DELIVERY_STATUSES, type DeliveryStatus } from '@solmira/contracts';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  STATUS_LABELS,
  STATUS_TONES,
  describeAttempt,
} from '@/components/webhooks/delivery-status';
import { EndpointForm } from '@/components/webhooks/endpoint-form';
import { ReplayRange } from '@/components/webhooks/replay-range';
import { SecretPanel } from '@/components/webhooks/secret-panel';
import { describeError } from '@/lib/api/client';
import {
  useArchiveEndpoint,
  useEndpoint,
  useEndpointDeliveries,
  useEventTypes,
  useTestSend,
  useUpdateEndpoint,
} from '@/lib/webhook-queries';

interface Ids {
  organizationId: string;
  applicationId: string;
  endpointId: string;
}

function EndpointDetail({ organizationId, applicationId, endpointId }: Ids) {
  const { can } = usePermissions();
  const notify = useToast();
  const endpoint = useEndpoint(organizationId, applicationId, endpointId);
  const eventTypes = useEventTypes(organizationId);
  const update = useUpdateEndpoint(organizationId, applicationId, endpointId);
  const testSend = useTestSend(organizationId, applicationId, endpointId);
  const archive = useArchiveEndpoint(organizationId, applicationId);
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<DeliveryStatus | ''>('failed');
  const [page, setPage] = useState(1);
  const deliveries = useEndpointDeliveries(organizationId, applicationId, endpointId, {
    page,
    pageSize: 25,
    ...(status ? { status } : {}),
  });

  if (endpoint.isPending) return <LoadingRows label="Loading endpoint" />;
  if (endpoint.isError) return <Alert tone="error">{describeError(endpoint.error)}</Alert>;
  const { data } = endpoint;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={data.url}
        description={data.description ?? undefined}
        actions={
          can('endpoints.update') && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                loading={testSend.isPending}
                onClick={() =>
                  testSend.mutate(undefined, {
                    onSuccess: () => notify('Test event queued'),
                    onError: (error) => notify(describeError(error), 'error'),
                  })
                }
              >
                Send test event
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="secondary"
                loading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { enabled: !data.enabled },
                    { onError: (error) => notify(describeError(error), 'error') },
                  )
                }
              >
                {data.enabled ? 'Disable' : 'Enable'}
              </Button>
              {can('endpoints.delete') && (
                <Button variant="ghost" onClick={() => setArchiving(true)}>
                  Archive
                </Button>
              )}
            </div>
          )
        }
      />
      {!data.enabled && (
        <Alert tone="warning" title="This endpoint is disabled">
          {data.disabledReason ?? 'Deliveries are paused.'} Enable it to resume; failed deliveries
          can be replayed afterwards.
        </Alert>
      )}
      <Dialog open={editing} title="Edit endpoint" onClose={() => setEditing(false)}>
        <EndpointForm
          initial={data}
          submitLabel="Save"
          eventTypes={eventTypes.data?.items ?? []}
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            await update.mutateAsync({
              url: values.url,
              description: values.description ?? null,
              rateLimitPerSecond: values.rateLimitPerSecond ?? null,
              headers: values.headers,
              eventTypeIds: values.eventTypeIds,
            });
            setEditing(false);
            notify('Endpoint saved');
          }}
        />
      </Dialog>
      <ConfirmDialog
        open={archiving}
        title="Archive this endpoint?"
        description="It stops receiving deliveries. Past messages and attempts stay visible."
        confirmLabel="Archive"
        pending={archive.isPending}
        onCancel={() => setArchiving(false)}
        onConfirm={() =>
          archive.mutate(endpointId, {
            onSuccess: () => router.push(`/applications/${applicationId}`),
            onError: (error) => {
              setArchiving(false);
              notify(describeError(error), 'error');
            },
          })
        }
      />
      <SecretPanel applicationId={applicationId} endpointId={endpointId} />
      <Panel
        title="Deliveries"
        actions={
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as DeliveryStatus | '');
              setPage(1);
            }}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            {DELIVERY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        }
      >
        {deliveries.isPending ? (
          <LoadingRows label="Loading deliveries" />
        ) : deliveries.isError ? (
          <div className="p-5">
            <Alert tone="error">{describeError(deliveries.error)}</Alert>
          </div>
        ) : deliveries.data.items.length === 0 ? (
          <EmptyState title="No deliveries match" />
        ) : (
          <>
            <Table caption="Deliveries">
              <THead>
                <Tr>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th>Last result</Th>
                  <Th>Attempts</Th>
                </Tr>
              </THead>
              <TBody>
                {deliveries.data.items.map((delivery) => (
                  <Tr key={delivery.id}>
                    <Td>
                      <Link
                        href={`/applications/${applicationId}/messages/${delivery.messageId}`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {delivery.eventType}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONES[delivery.status]}>
                        {STATUS_LABELS[delivery.status]}
                      </Badge>
                    </Td>
                    <Td className="text-ink-muted">
                      {delivery.lastAttemptAt
                        ? describeAttempt(delivery.lastStatusCode, delivery.lastErrorClass)
                        : 'Not tried yet'}
                    </Td>
                    <Td className="text-ink-muted">{delivery.attemptCount}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={deliveries.data} onChange={setPage} />
          </>
        )}
      </Panel>
      {can('deliveries.replay') && (
        <ReplayRange
          organizationId={organizationId}
          applicationId={applicationId}
          endpointId={endpointId}
        />
      )}
    </div>
  );
}

export default function EndpointPage() {
  const { applicationId, endpointId } = useParams<{ applicationId: string; endpointId: string }>();
  return (
    <RequireOrganization permission="endpoints.read">
      {(organization) => (
        <EndpointDetail
          organizationId={organization.id}
          applicationId={applicationId}
          endpointId={endpointId}
        />
      )}
    </RequireOrganization>
  );
}
