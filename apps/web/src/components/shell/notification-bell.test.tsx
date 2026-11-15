// @vitest-environment jsdom
import type { NotificationView, Page } from '@solmira/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { NotificationBell } from './notification-bell';

const APPLICATION = '0190a000-0000-7000-8000-000000000001';
const ENDPOINT = '0190a000-0000-7000-8000-000000000002';

const notification = (id: string, title: string): NotificationView => ({
  id,
  type: 'endpoint.auto_disabled',
  title,
  body: 'Deliveries to hooks.example have failed continuously since 2026-10-15.',
  data: { applicationId: APPLICATION, endpointId: ENDPOINT },
  createdAt: '2026-10-20T10:00:00.000Z',
  readAt: null,
});

const page = (items: NotificationView[], total = items.length): Page<NotificationView> => ({
  items,
  page: 1,
  pageSize: 5,
  total,
  totalPages: 1,
});

let granted: boolean;
let unread: { isPending: boolean; isError: boolean; data?: Page<NotificationView> };
const markRead = vi.fn();
const markAll = vi.fn();

vi.mock('@/components/auth/can', () => ({
  usePermissions: () => ({
    organization: { id: 'org', name: 'Northwind' },
    can: () => granted,
  }),
}));

vi.mock('@/lib/notification-queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notification-queries')>()),
  useNotifications: () => unread,
  useMarkNotificationRead: () => ({ mutate: markRead, isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: markAll, isPending: false }),
}));

function setup() {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <NotificationBell />
    </ToastProvider>,
  );
  return { user };
}

describe('NotificationBell', () => {
  beforeEach(() => {
    granted = true;
    unread = {
      isPending: false,
      isError: false,
      data: page([notification('n1', 'Endpoint disabled'), notification('n2', 'Second alert')], 12),
    };
    markRead.mockClear();
    markAll.mockClear();
  });

  it('shows the unread count, capped in the badge but exact for screen readers', () => {
    setup();
    const bell = screen.getByRole('button', { name: 'Notifications, 12 unread' });
    expect(bell.textContent).toBe('9+');
  });

  it('lists the newest unread notifications with a link to the endpoint', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: /Notifications/ }));

    const list = screen.getByRole('region', { name: 'Unread notifications' });
    expect(within(list).getByText('Endpoint disabled')).toBeTruthy();
    expect(
      within(list).getAllByRole('link', { name: 'Open endpoint' })[0]!.getAttribute('href'),
    ).toBe(`/applications/${APPLICATION}/endpoints/${ENDPOINT}`);
    expect(within(list).getByRole('link', { name: 'View all notifications' })).toBeTruthy();
  });

  it('marks one notification read', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(screen.getByRole('button', { name: 'Mark "Second alert" read' }));

    expect(markRead).toHaveBeenCalledWith('n2', expect.anything());
  });

  it('marks every notification read', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    expect(markAll).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing is unread', async () => {
    unread = { isPending: false, isError: false, data: page([]) };
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(screen.getByText('You are all caught up.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Mark all read' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('closes on Escape and gives focus back to the bell', async () => {
    const { user } = setup();
    const bell = screen.getByRole('button', { name: /Notifications/ });

    await user.click(bell);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Unread notifications' })).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it('is not shown without notifications.read', () => {
    granted = false;
    setup();
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
  });
});
