'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { QueryError, QueryLoading } from '@/components/ui/query-feedback';
import { useToast } from '@/components/ui/toast';
import { NotificationItem } from '@/components/notifications/notification-item';
import { describeError } from '@/lib/api/client';
import { useMarkAllNotificationsRead, useNotifications } from '@/lib/notification-queries';

/** How many unread notifications the bell lists; the rest are on the notifications page. */
const LISTED = 5;
const MAX_SHOWN_COUNT = 9;

/** The unread count in the top bar, with the newest unread notifications one click away. */
export function NotificationBell() {
  const { organization, can } = usePermissions();
  if (!organization || !can('notifications.read')) return null;
  return <UnreadNotifications organizationId={organization.id} />;
}

function UnreadNotifications({ organizationId }: { organizationId: string }) {
  const notify = useToast();
  const unread = useNotifications(organizationId, { unreadOnly: true, pageSize: LISTED });
  const markAll = useMarkAllNotificationsRead(organizationId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const count = unread.data?.total ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={count === 0 ? 'Notifications' : `Notifications, ${count} unread`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-md p-1.5 text-ink-muted hover:bg-canvas hover:text-ink"
      >
        <Bell aria-hidden className="size-5" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white"
          >
            {count > MAX_SHOWN_COUNT ? `${MAX_SHOWN_COUNT}+` : count}
          </span>
        )}
      </button>
      {open && (
        <section
          id={panelId}
          aria-label="Unread notifications"
          className="absolute top-full right-0 z-40 mt-1 w-80 rounded-lg border border-line bg-surface shadow-lg"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={count === 0}
              loading={markAll.isPending}
              onClick={() =>
                markAll.mutate(undefined, {
                  onError: (error) => notify(describeError(error), 'error'),
                })
              }
            >
              Mark all read
            </Button>
          </header>
          {unread.isPending ? (
            <QueryLoading query={unread} rows={2} label="Loading notifications" />
          ) : unread.isError ? (
            <div className="p-3">
              <QueryError query={unread} />
            </div>
          ) : unread.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">You are all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {unread.data.items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  organizationId={organizationId}
                  notification={notification}
                  compact
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
          <footer className="border-t border-line px-4 py-2 text-sm">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="font-medium text-accent hover:underline"
            >
              View all notifications
            </Link>
          </footer>
        </section>
      )}
    </div>
  );
}
