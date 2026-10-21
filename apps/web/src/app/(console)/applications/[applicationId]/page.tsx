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
import { Alert, EmptyState, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { QueryError, QueryLoading } from '@/components/ui/query-feedback';
import { SecretDisplay } from '@/components/ui/secret-display';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ApiKeysPanel } from '@/components/webhooks/api-keys-panel';
import { ApplicationForm } from '@/components/webhooks/application-form';
import { DeliveryHealthPanel } from '@/components/webhooks/delivery-health-panel';
import { EndpointForm } from '@/components/webhooks/endpoint-form';
import {
  useApplication,
  useCreateEndpoint,
  useEndpoints,
  useEventTypes,
  useUpdateApplication,
} from '@/lib/webhook-queries';

function ApplicationDetail({ organizationId, id }: { organizationId: string; id: string }) {
  const { can } = usePermissions();
  const application = useApplication(organizationId, id);
  const endpoints = useEndpoints(organizationId, id);
  const eventTypes = useEventTypes(organizationId);
  const create = useCreateEndpoint(organizationId, id);
  const update = useUpdateApplication(organizationId, id);
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedEndpoint>();

  if (application.isPending)
    return <QueryLoading query={application} label="Loading application" />;
  if (application.isError) return <QueryError query={application} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={application.data.name}
        description={application.data.description ?? 'Endpoints, API keys and messages.'}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/applications/${id}/messages`}
              className="text-sm font-medium text-accent hover:underline"
            >
              Inspect messages
            </Link>
            {can('applications.update') && !application.data.archivedAt && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
        }
      />
      <Dialog open={editing} title="Edit application" onClose={() => setEditing(false)}>
        <ApplicationForm
          initial={application.data}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            // An emptied description is cleared on the server, not left as it was.
            await update.mutateAsync({
              name: values.name,
              description: values.description ?? null,
            });
            setEditing(false);
            notify('Application saved');
          }}
        />
      </Dialog>
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
          <QueryLoading query={endpoints} label="Loading endpoints" />
        ) : endpoints.isError ? (
          <div className="p-5">
            <QueryError query={endpoints} />
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
