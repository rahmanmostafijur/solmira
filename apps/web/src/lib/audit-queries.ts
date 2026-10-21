'use client';

import type { AuditLogQuery, AuditRecord, Page } from '@solmira/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './auth/session-store';

const search = (query: Partial<AuditLogQuery>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
};

/** Tenant-owned keys start with ['org', organizationId], like every other query in the console. */
export const useAuditLog = (organizationId: string, query: Partial<AuditLogQuery>) =>
  useQuery({
    queryKey: ['org', organizationId, 'audit-logs', query],
    queryFn: () => api<Page<AuditRecord>>('/audit-logs' + search(query)),
    placeholderData: keepPreviousData,
  });
