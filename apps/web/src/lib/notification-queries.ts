'use client';

import type { NotificationView, Page, ReadAllNotificationsResult } from '@solmira/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './auth/session-store';

/** Tenant-owned like every other key: notifications belong to the organization. */
export const notificationKeys = {
  all: (org: string) => ['org', org, 'notifications'] as const,
};

/** Notifications are rare (an endpoint disabled after days of failures), so a slow poll is enough. */
const POLL_MS = 60_000;

export interface NotificationListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly unreadOnly?: boolean;
}

export const useNotifications = (org: string, query: NotificationListQuery, enabled = true) =>
  useQuery({
    queryKey: [...notificationKeys.all(org), query],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      const text = params.toString();
      return api<Page<NotificationView>>(`/notifications${text ? `?${text}` : ''}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    enabled,
  });

export function useMarkNotificationRead(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<NotificationView>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationKeys.all(org) }),
  });
}

export function useMarkAllNotificationsRead(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<ReadAllNotificationsResult>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationKeys.all(org) }),
  });
}

/** Where a notification points, when it is about something the console can show. */
export function notificationHref(notification: Pick<NotificationView, 'data'>): string | null {
  const data = notification.data;
  if (typeof data !== 'object' || data === null) return null;
  const { applicationId, endpointId } = data as Record<string, unknown>;
  if (typeof applicationId !== 'string') return null;
  return typeof endpointId === 'string'
    ? `/applications/${applicationId}/endpoints/${endpointId}`
    : `/applications/${applicationId}`;
}
