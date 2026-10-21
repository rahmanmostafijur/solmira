'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ApplicationForm } from '@/components/webhooks/application-form';
import { describeError } from '@/lib/api/client';
import {
  useApplications,
  useArchiveApplication,
  useCreateApplication,
} from '@/lib/webhook-queries';

function ApplicationsList({ organizationId }: { organizationId: string }) {
  const { can } = usePermissions();
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const applications = useApplications(organizationId, page, showArchived);
  const create = useCreateApplication(organizationId);
  const archive = useArchiveApplication(organizationId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Applications"
        description="An application is an app or environment of yours, such as production or staging. Each has its own endpoints, API keys and messages."
        actions={
          can('applications.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" />
              New application
            </Button>
          )
        }
      />
      <Dialog open={creating} title="New application" onClose={() => setCreating(false)}>
        <ApplicationForm
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            await create.mutateAsync(values);
            setCreating(false);
            notify('Application created');
          }}
        />
      </Dialog>
      <Panel
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => {
                setShowArchived(event.target.checked);
                setPage(1);
              }}
            />
            Show archived
          </label>
        }
      >
        {applications.isPending ? (
          <LoadingRows label="Loading applications" />
        ) : applications.isError ? (
          <div className="p-5">
            <Alert tone="error">{describeError(applications.error)}</Alert>
          </div>
        ) : applications.data.items.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="Create one to start adding endpoints and sending messages."
          />
        ) : (
          <>
            <Table caption="Applications">
              <THead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </Tr>
              </THead>
              <TBody>
                {applications.data.items.map((application) => (
                  <Tr key={application.id}>
                    <Td>
                      <Link
                        href={`/applications/${application.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {application.name}
                      </Link>
                      {application.archivedAt && <Badge tone="warning"> Archived</Badge>}
                      {application.description && (
                        <p className="text-xs text-ink-muted">{application.description}</p>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      {new Date(application.createdAt).toLocaleDateString()}
                    </Td>
                    <Td className="text-right">
                      {can('applications.delete') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={archive.isPending && archive.variables?.id === application.id}
                          onClick={() =>
                            archive.mutate(
                              { id: application.id, restore: application.archivedAt !== null },
                              { onError: (error) => notify(describeError(error), 'error') },
                            )
                          }
                        >
                          {application.archivedAt ? 'Restore' : 'Archive'}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={applications.data} onChange={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}

export default function ApplicationsPage() {
  return (
    <RequireOrganization permission="applications.read">
      {(organization) => <ApplicationsList organizationId={organization.id} />}
    </RequireOrganization>
  );
}
