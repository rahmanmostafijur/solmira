'use client';

import {
  IDEMPOTENCY_KEY_HEADER,
  type AddPurchaseOrderItemRequest,
  type CancelPurchaseOrderRequest,
  type CreatePurchaseOrderRequest,
  type Page,
  type PurchaseOrderDetail,
  type PurchaseOrderListQuery,
  type PurchaseOrderSummary,
  type PurchaseReceipt,
  type PurchaseReceiptResult,
  type ReceivePurchaseOrderRequest,
  type SupplierPurchasingSummary,
  type UpdatePurchaseOrderItemRequest,
  type UpdatePurchaseOrderRequest,
} from '@solmira/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './auth/session-store';
import { inventoryKeys } from './inventory-queries';
import { toApiQuery } from './list-params';

/**
 * Every purchasing key starts with ['org', organizationId, 'purchasing']: one order change moves
 * its detail, the lists and the supplier's purchasing summary together, so a single invalidation
 * refreshes all of them.
 */
export const purchasingKeys = {
  all: (org: string) => ['org', org, 'purchasing'] as const,
  orders: (org: string, query: object) => ['org', org, 'purchasing', 'orders', query] as const,
  order: (org: string, id: string) => ['org', org, 'purchasing', 'order', id] as const,
  receipts: (org: string, id: string) =>
    ['org', org, 'purchasing', 'order', id, 'receipts'] as const,
  supplierSummary: (org: string, supplierId: string) =>
    ['org', org, 'purchasing', 'supplier', supplierId, 'summary'] as const,
};

/**
 * An order write. The cache is refreshed whether it succeeds or not: a refusal such as a CONFLICT
 * on the status means the order on screen was stale, so it is reloaded either way. A receipt also
 * moves stock, so it refreshes inventory too.
 */
function usePurchasingMutation<TInput, TResult>(
  org: string,
  run: (input: TInput) => Promise<TResult>,
  { movesStock = false }: { movesStock?: boolean } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: purchasingKeys.all(org) }),
        movesStock ? client.invalidateQueries({ queryKey: inventoryKeys.all(org) }) : undefined,
      ]);
    },
  });
}

const json = (method: 'POST' | 'PATCH', body: unknown) => ({ method, body }) as const;

// ---- orders -------------------------------------------------------------------------------------

export const usePurchaseOrders = (
  org: string,
  query: Partial<PurchaseOrderListQuery>,
  enabled = true,
) =>
  useQuery({
    queryKey: purchasingKeys.orders(org, query),
    queryFn: ({ signal }) =>
      api<Page<PurchaseOrderSummary>>(`/purchase-orders?${toApiQuery(query)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const usePurchaseOrder = (org: string, id: string) =>
  useQuery({
    queryKey: purchasingKeys.order(org, id),
    queryFn: ({ signal }) => api<PurchaseOrderDetail>(`/purchase-orders/${id}`, { signal }),
  });

export const useCreatePurchaseOrder = (org: string) =>
  usePurchasingMutation(org, (body: CreatePurchaseOrderRequest) =>
    api<PurchaseOrderDetail>('/purchase-orders', json('POST', body)),
  );

export const useUpdatePurchaseOrder = (org: string, id: string) =>
  usePurchasingMutation(org, (body: UpdatePurchaseOrderRequest) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${id}`, json('PATCH', body)),
  );

// ---- lines (drafts only) ------------------------------------------------------------------------

export const useAddPurchaseOrderItem = (org: string, id: string) =>
  usePurchasingMutation(org, (body: AddPurchaseOrderItemRequest) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${id}/items`, json('POST', body)),
  );

export const useUpdatePurchaseOrderItem = (org: string, id: string) =>
  usePurchasingMutation(
    org,
    ({ itemId, change }: { itemId: string; change: UpdatePurchaseOrderItemRequest }) =>
      api<PurchaseOrderDetail>(`/purchase-orders/${id}/items/${itemId}`, json('PATCH', change)),
  );

export const useRemovePurchaseOrderItem = (org: string, id: string) =>
  usePurchasingMutation(org, (itemId: string) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${id}/items/${itemId}`, { method: 'DELETE' }),
  );

// ---- lifecycle ----------------------------------------------------------------------------------

export const useSubmitPurchaseOrder = (org: string) =>
  usePurchasingMutation(org, (id: string) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${id}/submit`, { method: 'POST' }),
  );

export const useApprovePurchaseOrder = (org: string) =>
  usePurchasingMutation(org, (id: string) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${id}/approve`, { method: 'POST' }),
  );

export const useCancelPurchaseOrder = (org: string) =>
  usePurchasingMutation(org, ({ id, body }: { id: string; body: CancelPurchaseOrderRequest }) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${id}/cancel`, json('POST', body)),
  );

// ---- receipts -----------------------------------------------------------------------------------

export const usePurchaseReceipts = (org: string, id: string, enabled = true) =>
  useQuery({
    queryKey: purchasingKeys.receipts(org, id),
    queryFn: ({ signal }) => api<PurchaseReceipt[]>(`/purchase-orders/${id}/receipts`, { signal }),
    enabled,
  });

/**
 * Receiving is retry-safe: the caller keeps one idempotency key per receiving attempt and sends
 * it again on a retry, so a receipt whose response was lost is replayed rather than doubled.
 */
export const useReceivePurchaseOrder = (org: string, id: string) =>
  usePurchasingMutation(
    org,
    ({ body, idempotencyKey }: { body: ReceivePurchaseOrderRequest; idempotencyKey: string }) =>
      api<PurchaseReceiptResult>(`/purchase-orders/${id}/receipts`, {
        ...json('POST', body),
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      }),
    { movesStock: true },
  );

// ---- suppliers ----------------------------------------------------------------------------------

export const useSupplierPurchasingSummary = (org: string, supplierId: string, enabled = true) =>
  useQuery({
    queryKey: purchasingKeys.supplierSummary(org, supplierId),
    queryFn: ({ signal }) =>
      api<SupplierPurchasingSummary>(`/suppliers/${supplierId}/purchasing-summary`, { signal }),
    enabled,
  });
