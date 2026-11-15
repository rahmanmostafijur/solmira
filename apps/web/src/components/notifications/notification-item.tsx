'use client';

import type { NotificationView } from '@solmira/contracts';
import clsx from 'clsx';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { notificationHref, useMarkNotificationRead } from '@/lib/notification-queries';

/**
 * One notification with its read state. Reading it reads it for the whole organization, as the
 * API records it. `compact` is the top-bar list, which shows only unread ones.
 */
export function NotificationItem({
  organizationId,
  notification,
  compact = false,
  onNavigate,
}: {
  organizationId: string;
  notification: NotificationView;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const markRead = useMarkNotificationRead(organizationId);
  const notify = useToast();
  const href = notificationHref(notification);
  const unread = notification.readAt === null;

  return (
    <li className={clsx('flex gap-3 text-sm', compact ? 'px-4 py-3' : 'px-5 py-4')}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {notification.title}
          {!compact && unread && <Badge tone="info">Unread</Badge>}
        </p>
        <p className="text-ink-muted">{notification.body}</p>
        <p className="text-xs text-ink-muted">
          {new Date(notification.createdAt).toLocaleString()}
          {href && (
            <>
              {' · '}
              <Link
                href={href}
                onClick={onNavigate}
                className="font-medium text-accent hover:underline"
              >
                {href.includes('/endpoints/') ? 'Open endpoint' : 'Open application'}
              </Link>
            </>
          )}
        </p>
      </div>
      {unread && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Mark "${notification.title}" read`}
          loading={markRead.isPending}
          onClick={() =>
            markRead.mutate(notification.id, {
              onError: (error) => notify(describeError(error), 'error'),
            })
          }
        >
          Mark read
        </Button>
      )}
    </li>
  );
}
