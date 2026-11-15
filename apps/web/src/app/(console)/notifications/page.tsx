'use client';

import { useState } from 'react';
import { RequireOrganization } from '@/components/auth/require-organization';
import { NotificationItem } from '@/components/notifications/notification-item';
import { Button } from '@/components/ui/button';
import { EmptyState, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { QueryError, QueryLoading } from '@/components/ui/query-feedback';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useMarkAllNotificationsRead, useNotifications } from '@/lib/notification-queries';

const PAGE_SIZE = 25;

function Notifications({ organizationId }: { organizationId: string }) {
  const notify = useToast();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useNotifications(organizationId, {
    page,
    pageSize: PAGE_SIZE,
    unreadOnly,
  });
  const markAll = useMarkAllNotificationsRead(organizationId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Notifications"
        description="Alerts for this organization, such as an endpoint disabled after repeated failures. Reading one reads it for every member."
        actions={
          <Button
            variant="secondary"
            loading={markAll.isPending}
            onClick={() =>
              markAll.mutate(undefined, {
                onSuccess: ({ updated }) =>
                  notify(
                    updated === 0
                      ? 'Everything was already read'
                      : `${updated} notification${updated === 1 ? '' : 's'} marked read`,
                  ),
                onError: (error) => notify(describeError(error), 'error'),
              })
            }
          >
            Mark all read
          </Button>
        }
      />
      <Panel
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => {
                setUnreadOnly(event.target.checked);
                setPage(1);
              }}
            />
            Unread only
          </label>
        }
      >
        {notifications.isPending ? (
          <QueryLoading query={notifications} label="Loading notifications" />
        ) : notifications.isError ? (
          <div className="p-5">
            <QueryError query={notifications} />
          </div>
        ) : notifications.data.items.length === 0 ? (
          <EmptyState
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            description="You are told here when something needs attention."
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {notifications.data.items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  organizationId={organizationId}
                  notification={notification}
                />
              ))}
            </ul>
            <Pagination page={notifications.data} onChange={setPage} />
          </>
        )}
      </Panel>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <RequireOrganization permission="notifications.read">
      {(organization) => <Notifications organizationId={organization.id} />}
    </RequireOrganization>
  );
}
