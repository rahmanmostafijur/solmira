'use client';

import type { EventType } from '@solmira/contracts';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { QueryError, QueryLoading } from '@/components/ui/query-feedback';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { EventTypeForm } from '@/components/webhooks/event-type-form';
import { describeError } from '@/lib/api/client';
import {
  useArchiveEventType,
  useCreateEventType,
  useEventTypes,
  useUpdateEventType,
} from '@/lib/webhook-queries';

function EventTypes({ organizationId }: { organizationId: string }) {
  const { can } = usePermissions();
  const notify = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EventType | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const eventTypes = useEventTypes(organizationId, showArchived);
  const create = useCreateEventType(organizationId);
  const update = useUpdateEventType(organizationId);
  const archive = useArchiveEventType(organizationId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Event types"
        description="The kinds of events you send, shared by all applications of this organization. A schema, if you add one, validates every message of that type."
        actions={
          can('event_types.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" />
              New event type
            </Button>
          )
        }
      />
      <Dialog open={creating} title="New event type" onClose={() => setCreating(false)}>
        <EventTypeForm
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            await create.mutateAsync(values);
            setCreating(false);
            notify('Event type created');
          }}
        />
      </Dialog>
      <Dialog open={editing !== null} title="Edit event type" onClose={() => setEditing(null)}>
        {editing && (
          <EventTypeForm
            initial={editing}
            submitLabel="Save"
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              // Emptied fields are cleared: no description, no payload validation.
              await update.mutateAsync({
                id: editing.id,
                change: { description: values.description ?? null, schema: values.schema ?? null },
              });
              setEditing(null);
              notify('Event type saved');
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={archiving !== null}
        title={`Archive ${archiving?.name ?? ''}?`}
        description="New messages of this type are rejected and endpoints can no longer subscribe to it. Existing messages are kept."
        confirmLabel="Archive"
        pending={archive.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={() =>
          archiving &&
          archive.mutate(
            { id: archiving.id },
            {
              onSuccess: () => {
                setArchiving(null);
                notify('Event type archived');
              },
              onError: (error) => notify(describeError(error), 'error'),
            },
          )
        }
      />
      <Panel
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
        }
      >
        {eventTypes.isPending ? (
          <QueryLoading query={eventTypes} label="Loading event types" />
        ) : eventTypes.isError ? (
          <div className="p-5">
            <QueryError query={eventTypes} />
          </div>
        ) : eventTypes.data.items.length === 0 ? (
          <EmptyState
            title="No event types yet"
            description="Create one, such as invoice.paid, before sending messages."
          />
        ) : (
          <Table caption="Event types">
            <THead>
              <Tr>
                <Th>Name</Th>
                <Th>Payload schema</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {eventTypes.data.items.map((eventType) => (
                <Tr key={eventType.id}>
                  <Td>
                    <code className="font-mono text-xs">{eventType.name}</code>
                    {eventType.archivedAt && <Badge tone="warning"> Archived</Badge>}
                    {eventType.description && (
                      <p className="text-xs text-ink-muted">{eventType.description}</p>
                    )}
                  </Td>
                  <Td className="text-ink-muted">{eventType.schema ? 'Validated' : 'None'}</Td>
                  <Td className="text-right">
                    {can('event_types.update') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${eventType.name}`}
                        onClick={() => setEditing(eventType)}
                      >
                        Edit
                      </Button>
                    )}
                    {can('event_types.delete') && !eventType.archivedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Archive ${eventType.name}`}
                        onClick={() => setArchiving({ id: eventType.id, name: eventType.name })}
                      >
                        Archive
                      </Button>
                    )}
                    {can('event_types.delete') && eventType.archivedAt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Restore ${eventType.name}`}
                        loading={archive.isPending && archive.variables?.id === eventType.id}
                        onClick={() =>
                          archive.mutate(
                            { id: eventType.id, restore: true },
                            {
                              onSuccess: () => notify('Event type restored'),
                              onError: (error) => notify(describeError(error), 'error'),
                            },
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export default function EventTypesPage() {
  return (
    <RequireOrganization permission="event_types.read">
      {(organization) => <EventTypes organizationId={organization.id} />}
    </RequireOrganization>
  );
}
