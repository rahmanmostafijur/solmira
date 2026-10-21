'use client';

import type { CreatedEndpoint } from '@solmira/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { SecretDisplay } from '@/components/ui/secret-display';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { ApiKeysPanel } from '@/components/webhooks/api-keys-panel';
import { DeliveryHealthPanel } from '@/components/webhooks/delivery-health-panel';
import { EndpointForm } from '@/components/webhooks/endpoint-form';
import { describeError } from '@/lib/api/client';
import {
  useApplication,
  useCreateEndpoint,
  useEndpoints,
  useEventTypes,
} from '@/lib/webhook-queries';

function ApplicationDetail({ organizationId, id }: { organizationId: string; id: string }) {
  const { can } = usePermissions();
  const application = useApplication(organizationId, id);
  const endpoints = useEndpoints(organizationId, id);
  const eventTypes = useEventTypes(organizationId);
  const create = useCreateEndpoint(organizationId, id);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedEndpoint>();

  if (application.isPending) return <LoadingRows label="Loading application" />;
  if (application.isError) return <Alert tone="error">{describeError(application.error)}</Alert>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={application.data.name}
        description={application.data.description ?? 'Endpoints, API keys and messages.'}
        actions={
          <Link
            href={`/applications/${id}/messages`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Inspect messages
          </Link>
        }
      />
      <Dialog open={creating} title="New endpoint" onClose={() => setCreating(false)}>
        <EndpointForm
          eventTypes={eventTypes.data?.items ?? []}
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            setCreated(await create.mutateAsync({ ...values, enabled: true }));
            setCreating(false);
          }}
        />
      </Dialog>
      <Dialog
        open={created !== undefined}
        title="Copy the signing secret"
        onClose={() => setCreated(undefined)}
      >
        {created && (
          <div className="space-y-4">
            <Alert tone="warning">
              Use this secret to verify signatures. You can reveal it again later, which is recorded
              in the audit log.
            </Alert>
            <SecretDisplay label="Signing secret" value={created.signingSecret} />
            <div className="flex justify-end">
              <Button onClick={() => setCreated(undefined)}>Done</Button>
            </div>
          </div>
        )}
      </Dialog>
      <Panel
        title="Endpoints"
        description="Where messages are delivered."
        actions={
          can('endpoints.create') && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" />
              New endpoint
            </Button>
          )
        }
      >
        {endpoints.isPending ? (
          <LoadingRows label="Loading endpoints" />
        ) : endpoints.isError ? (
          <div className="p-5">
            <Alert tone="error">{describeError(endpoints.error)}</Alert>
          </div>
        ) : endpoints.data.items.length === 0 ? (
          <EmptyState
            title="No endpoints yet"
            description="Add the URL that should receive events."
          />
        ) : (
          <Table caption="Endpoints">
            <THead>
              <Tr>
                <Th>URL</Th>
                <Th>Status</Th>
                <Th>Events</Th>
              </Tr>
            </THead>
            <TBody>
              {endpoints.data.items.map((endpoint) => (
                <Tr key={endpoint.id}>
                  <Td>
                    <Link
                      href={`/applications/${id}/endpoints/${endpoint.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {endpoint.url}
                    </Link>
                  </Td>
                  <Td>
                    {endpoint.enabled ? (
                      <Badge tone="success">Enabled</Badge>
                    ) : (
                      <Badge tone="warning">Disabled</Badge>
                    )}
                  </Td>
                  <Td className="text-ink-muted">
                    {endpoint.eventTypeIds.length === 0
                      ? 'All'
                      : `${endpoint.eventTypeIds.length} selected`}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      {can('analytics.read') && (
        <DeliveryHealthPanel organizationId={organizationId} applicationId={id} />
      )}
      <ApiKeysPanel organizationId={organizationId} applicationId={id} />
    </div>
  );
}

export default function ApplicationPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  return (
    <RequireOrganization permission="applications.read">
      {(organization) => <ApplicationDetail organizationId={organization.id} id={applicationId} />}
    </RequireOrganization>
  );
}
