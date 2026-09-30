'use client';

import type {
  AdjustStockRequest,
  InventoryLevel,
  InventoryLevelListQuery,
  InventoryMovement,
  InventoryMovementListQuery,
  Page,
  ReservationListQuery,
  ReserveStockRequest,
  StockReservation,
  StockTransferResult,
  TransferStockRequest,
  UpdateInventoryLevelRequest,
} from '@solmira/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './auth/session-store';
import { toApiQuery } from './list-params';

/**
 * Every inventory key starts with ['org', organizationId, 'inventory']: one stock change moves
 * levels, the ledger and reservations together, so a single invalidation refreshes all of them.
 */
export const inventoryKeys = {
  all: (org: string) => ['org', org, 'inventory'] as const,
  levels: (org: string, query: object) => ['org', org, 'inventory', 'levels', query] as const,
  level: (org: string, id: string) => ['org', org, 'inventory', 'level', id] as const,
  movements: (org: string, query: object) => ['org', org, 'inventory', 'movements', query] as const,
  reservations: (org: string, query: object) =>
    ['org', org, 'inventory', 'reservations', query] as const,
};

/**
 * A stock write. The cache is refreshed whether it succeeds or not: a refusal such as
 * INSUFFICIENT_STOCK means the numbers on screen were stale, so they are reloaded either way.
 */
function useInventoryMutation<TInput, TResult>(
  org: string,
  run: (input: TInput) => Promise<TResult>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => client.invalidateQueries({ queryKey: inventoryKeys.all(org) }),
  });
}

const json = (method: 'POST' | 'PATCH', body: unknown) => ({ method, body }) as const;

// ---- levels -------------------------------------------------------------------------------------

export const useInventoryLevels = (org: string, query: Partial<InventoryLevelListQuery>) =>
  useQuery({
    queryKey: inventoryKeys.levels(org, query),
    queryFn: ({ signal }) => {
      const { lowStock, ...rest } = query;
      const search = toApiQuery({
        ...rest,
        lowStock: lowStock === undefined ? undefined : String(lowStock),
      });
      return api<Page<InventoryLevel>>(`/inventory/levels?${search}`, { signal });
    },
    placeholderData: keepPreviousData,
  });

export const useInventoryLevel = (org: string, id: string) =>
  useQuery({
    queryKey: inventoryKeys.level(org, id),
    queryFn: ({ signal }) => api<InventoryLevel>(`/inventory/levels/${id}`, { signal }),
  });

export const useUpdateReorderPoint = (org: string) =>
  useInventoryMutation(org, ({ id, change }: { id: string; change: UpdateInventoryLevelRequest }) =>
    api<InventoryLevel>(`/inventory/levels/${id}`, json('PATCH', change)),
  );

// ---- movements ----------------------------------------------------------------------------------

export const useMovements = (org: string, query: Partial<InventoryMovementListQuery>) =>
  useQuery({
    queryKey: inventoryKeys.movements(org, query),
    queryFn: ({ signal }) =>
      api<Page<InventoryMovement>>(`/inventory/movements?${toApiQuery(query)}`, { signal }),
    placeholderData: keepPreviousData,
  });

export const useAdjustStock = (org: string) =>
  useInventoryMutation(org, (body: AdjustStockRequest) =>
    api<InventoryLevel>('/inventory/adjustments', json('POST', body)),
  );

export const useTransferStock = (org: string) =>
  useInventoryMutation(org, (body: TransferStockRequest) =>
    api<StockTransferResult>('/inventory/transfers', json('POST', body)),
  );

// ---- reservations -------------------------------------------------------------------------------

export const useReservations = (org: string, query: Partial<ReservationListQuery>) =>
  useQuery({
    queryKey: inventoryKeys.reservations(org, query),
    queryFn: ({ signal }) =>
      api<Page<StockReservation>>(`/inventory/reservations?${toApiQuery(query)}`, { signal }),
    placeholderData: keepPreviousData,
  });

export const useReserveStock = (org: string) =>
  useInventoryMutation(org, (body: ReserveStockRequest) =>
    api<StockReservation[]>('/inventory/reservations', json('POST', body)),
  );

export const useReleaseReservation = (org: string) =>
  useInventoryMutation(org, (id: string) =>
    api<StockReservation>(`/inventory/reservations/${id}/release`, { method: 'POST' }),
  );
