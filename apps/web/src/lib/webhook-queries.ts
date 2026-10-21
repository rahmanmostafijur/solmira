'use client';

import type {
  Application,
  ApiKey,
  ApplicationReport,
  CreateApiKeyRequest,
  CreateApplicationRequest,
  CreateEndpointRequest,
  CreateEventTypeRequest,
  CreatedApiKey,
  CreatedEndpoint,
  DeliveryListQuery,
  DeliverySummary,
  Endpoint,
  EventType,
  MessageDetail,
  MessageListQuery,
  MessageSummary,
  Page,
  ReplayEndpointRequest,
  ReplayResult,
  RevealedSecret,
  RotateSecretRequest,
  RotatedSecret,
  TestSendResult,
  UpdateEndpointRequest,
} from '@solmira/contracts';
import { useFeedStatus } from './realtime/feed-status';
import type { FeedStatus } from './realtime/delivery-feed';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './auth/session-store';

/** Tenant-owned keys start with ['org', organizationId], like every other query in the console. */
export const webhookKeys = {
  applications: (org: string) => ['org', org, 'applications'] as const,
  application: (org: string, id: string) => ['org', org, 'applications', id] as const,
  eventTypes: (org: string) => ['org', org, 'event-types'] as const,
  endpoints: (org: string, app: string) => ['org', org, 'applications', app, 'endpoints'] as const,
  endpoint: (org: string, app: string, id: string) =>
    ['org', org, 'applications', app, 'endpoints', id] as const,
  apiKeys: (org: string, app: string) => ['org', org, 'applications', app, 'api-keys'] as const,
  messages: (org: string, app: string) => ['org', org, 'applications', app, 'messages'] as const,
  message: (org: string, app: string, id: string) =>
    ['org', org, 'applications', app, 'messages', id] as const,
  analytics: (org: string, app: string) => ['org', org, 'applications', app, 'analytics'] as const,
  deliveries: (org: string, app: string, endpoint: string) =>
    ['org', org, 'applications', app, 'endpoints', endpoint, 'deliveries'] as const,
};

const search = (params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : '';
};

// ---- applications -------------------------------------------------------------------------------

export const useApplications = (org: string, page = 1, includeArchived = false) =>
  useQuery({
    queryKey: [...webhookKeys.applications(org), { page, includeArchived }],
    queryFn: () => api<Page<Application>>('/applications' + search({ page, includeArchived })),
    placeholderData: keepPreviousData,
  });

export const useApplication = (org: string, id: string) =>
  useQuery({
    queryKey: webhookKeys.application(org, id),
    queryFn: () => api<Application>(`/applications/${id}`),
  });

export function useCreateApplication(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApplicationRequest) =>
      api<Application>('/applications', { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.applications(org) }),
  });
}

export function useArchiveApplication(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, restore }: { id: string; restore?: boolean }) =>
      api<Application>(`/applications/${id}/${restore ? 'restore' : 'archive'}`, {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.applications(org) }),
  });
}

// ---- event types --------------------------------------------------------------------------------

export const useEventTypes = (org: string, includeArchived = false) =>
  useQuery({
    queryKey: [...webhookKeys.eventTypes(org), { includeArchived }],
    queryFn: () =>
      api<Page<EventType>>('/event-types' + search({ pageSize: 100, includeArchived })),
  });

export function useCreateEventType(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEventTypeRequest) =>
      api<EventType>('/event-types', { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.eventTypes(org) }),
  });
}

export function useArchiveEventType(org: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<EventType>(`/event-types/${id}/archive`, { method: 'POST' }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.eventTypes(org) }),
  });
}

// ---- endpoints ----------------------------------------------------------------------------------

export const useEndpoints = (org: string, app: string, includeArchived = false) =>
  useQuery({
    queryKey: [...webhookKeys.endpoints(org, app), { includeArchived }],
    queryFn: () =>
      api<Page<Endpoint>>(
        `/applications/${app}/endpoints` + search({ pageSize: 100, includeArchived }),
      ),
  });

export const useEndpoint = (org: string, app: string, id: string) =>
  useQuery({
    queryKey: webhookKeys.endpoint(org, app, id),
    queryFn: () => api<Endpoint>(`/applications/${app}/endpoints/${id}`),
  });

export function useCreateEndpoint(org: string, app: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEndpointRequest) =>
      api<CreatedEndpoint>(`/applications/${app}/endpoints`, { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.endpoints(org, app) }),
  });
}

export function useUpdateEndpoint(org: string, app: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateEndpointRequest) =>
      api<Endpoint>(`/applications/${app}/endpoints/${id}`, { method: 'PATCH', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.endpoints(org, app) }),
  });
}

export function useArchiveEndpoint(org: string, app: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/applications/${app}/endpoints/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.endpoints(org, app) }),
  });
}

export function useRevealSecret(app: string, id: string) {
  return useMutation({
    mutationFn: () =>
      api<RevealedSecret>(`/applications/${app}/endpoints/${id}/secret/reveal`, { method: 'POST' }),
  });
}

export function useRotateSecret(app: string, id: string) {
  return useMutation({
    mutationFn: (body: RotateSecretRequest) =>
      api<RotatedSecret>(`/applications/${app}/endpoints/${id}/secret/rotate`, {
        method: 'POST',
        body,
      }),
  });
}

export function useTestSend(org: string, app: string, id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<TestSendResult>(`/applications/${app}/endpoints/${id}/test`, { method: 'POST' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: webhookKeys.deliveries(org, app, id) });
      void client.invalidateQueries({ queryKey: webhookKeys.messages(org, app) });
    },
  });
}

// ---- API keys -----------------------------------------------------------------------------------

export const useApiKeys = (org: string, app: string, enabled = true) =>
  useQuery({
    queryKey: webhookKeys.apiKeys(org, app),
    queryFn: () => api<Page<ApiKey>>(`/applications/${app}/api-keys` + search({ pageSize: 100 })),
    enabled,
  });

export function useCreateApiKey(org: string, app: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApiKeyRequest) =>
      api<CreatedApiKey>(`/applications/${app}/api-keys`, { method: 'POST', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.apiKeys(org, app) }),
  });
}

export function useRevokeApiKey(org: string, app: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/applications/${app}/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: webhookKeys.apiKeys(org, app) }),
  });
}

// ---- messages and deliveries --------------------------------------------------------------------

/**
 * Messages can still be moving through the queue. While the realtime feed is live it tells the
 * views when to reload; without it they poll.
 */
const LIVE_REFRESH_MS = 3_000;
const pollingWithout = (feed: FeedStatus) => (feed === 'live' ? false : LIVE_REFRESH_MS);

export const useMessages = (org: string, app: string, query: Partial<MessageListQuery>) => {
  const feed = useFeedStatus();
  return useQuery({
    queryKey: [...webhookKeys.messages(org, app), query],
    queryFn: () =>
      api<Page<MessageSummary>>(`/applications/${app}/messages` + search({ ...query })),
    placeholderData: keepPreviousData,
    refetchInterval: pollingWithout(feed),
  });
};

export const useMessage = (org: string, app: string, id: string) => {
  const feed = useFeedStatus();
  return useQuery({
    queryKey: webhookKeys.message(org, app, id),
    queryFn: () => api<MessageDetail>(`/applications/${app}/messages/${id}`),
    refetchInterval: (query) =>
      query.state.data?.deliveries.some((d) => d.status === 'pending' || d.status === 'in_progress')
        ? pollingWithout(feed)
        : false,
  });
};

export const useEndpointDeliveries = (
  org: string,
  app: string,
  endpoint: string,
  query: Partial<DeliveryListQuery>,
) => {
  const feed = useFeedStatus();
  return useQuery({
    queryKey: [...webhookKeys.deliveries(org, app, endpoint), query],
    queryFn: () =>
      api<Page<DeliverySummary>>(
        `/applications/${app}/endpoints/${endpoint}/deliveries` + search({ ...query }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: pollingWithout(feed),
  });
};

// ---- analytics ----------------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** Delivery health of one application over the last `hours`, refreshed when deliveries happen. */
export const useApplicationAnalytics = (org: string, app: string, hours = 24) =>
  useQuery({
    queryKey: [...webhookKeys.analytics(org, app), { hours }],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - hours * HOUR_MS);
      return api<ApplicationReport>(
        `/analytics/applications/${app}` +
          search({ from: from.toISOString(), to: to.toISOString() }),
      );
    },
  });

export function useReplayMessage(org: string, app: string, messageId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (endpointId?: string) =>
      api<ReplayResult>(`/applications/${app}/messages/${messageId}/replay`, {
        method: 'POST',
        body: endpointId ? { endpointId } : {},
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: webhookKeys.message(org, app, messageId) }),
  });
}

export function useReplayEndpoint(org: string, app: string, endpointId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<ReplayEndpointRequest, 'from' | 'to'> & { limit?: number }) =>
      api<ReplayResult>(`/applications/${app}/endpoints/${endpointId}/replay`, {
        method: 'POST',
        body,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: webhookKeys.deliveries(org, app, endpointId) }),
  });
}
