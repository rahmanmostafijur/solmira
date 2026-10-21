'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RequireOrganization } from '@/components/auth/require-organization';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { summarizeDeliveries } from '@/components/webhooks/delivery-status';
import { describeError } from '@/lib/api/client';
import { useMessages } from '@/lib/webhook-queries';

function Messages({ organizationId, id }: { organizationId: string; id: string }) {
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState('');
  const messages = useMessages(organizationId, id, {
    page,
    pageSize: 25,
    ...(eventType.trim() ? { eventType: eventType.trim() } : {}),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Messages"
        description="Everything sent to this application, newest first. Open one to see its payload and every delivery attempt."
      />
      <Panel
        actions={
          <input
            aria-label="Filter by event type"
            placeholder="Filter by event type"
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value);
              setPage(1);
            }}
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
          />
        }
      >
        {messages.isPending ? (
          <LoadingRows label="Loading messages" />
        ) : messages.isError ? (
          <div className="p-5">
            <Alert tone="error">{describeError(messages.error)}</Alert>
          </div>
        ) : messages.data.items.length === 0 ? (
          <EmptyState
            title="No messages"
            description="Messages appear here once your backend sends them."
          />
        ) : (
          <>
            <Table caption="Messages">
              <THead>
                <Tr>
                  <Th>Event</Th>
                  <Th>Deliveries</Th>
                  <Th>Created</Th>
                </Tr>
              </THead>
              <TBody>
                {messages.data.items.map((message) => (
                  <Tr key={message.id}>
                    <Td>
                      <Link
                        href={`/applications/${id}/messages/${message.id}`}
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {message.eventType}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{summarizeDeliveries(message.deliveries)}</Td>
                    <Td className="text-ink-muted">
                      {new Date(message.createdAt).toLocaleString()}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={messages.data} onChange={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}

export default function MessagesPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  return (
    <RequireOrganization permission="messages.read">
      {(organization) => <Messages organizationId={organization.id} id={applicationId} />}
    </RequireOrganization>
  );
}
