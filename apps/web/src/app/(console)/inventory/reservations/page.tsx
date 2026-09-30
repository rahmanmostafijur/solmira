'use client';

import {
  RESERVATION_STATUSES,
  reservationListQuerySchema,
  type StockReservation,
} from '@solmira/contracts';
import { Suspense, useMemo, useState } from 'react';
import { z } from 'zod';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { formatDateTime } from '@/components/catalog/labels';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { RESERVATION_STATUS_LABELS } from '@/components/inventory/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { useReleaseReservation, useReservations } from '@/lib/inventory-queries';
import { useListParams } from '@/lib/list-params';

/**
 * Held stock is what people come here for, so the list opens on active reservations; "ALL" in
 * the URL is the page's own value for no status filter and is never sent to the API.
 */
const STATUS_FILTERS = [...RESERVATION_STATUSES, 'ALL'] as const;
const reservationParamsSchema = reservationListQuerySchema.extend({
  status: z.enum(STATUS_FILTERS).default('ACTIVE'),
});
type ReservationParams = z.output<typeof reservationParamsSchema>;

const helper = columnHelper<StockReservation>();

function reservationColumns(
  canRelease: boolean,
  onRelease: (reservation: StockReservation) => void,
): DataColumn<StockReservation>[] {
  return [
    helper.accessor('reference', {
      meta: { label: 'Reference', alwaysVisible: true },
      cell: ({ row }) => (
        <div className="min-w-40">
          <p className="font-medium">{row.original.reference}</p>
          {row.original.note && (
            <p className="line-clamp-1 text-xs text-ink-muted">{row.original.note}</p>
          )}
        </div>
      ),
    }),
    helper.accessor((row) => row.item.sku, {
      id: 'sku',
      meta: { label: 'SKU' },
      cell: ({ row }) => (
        <div>
          <span className="font-mono text-xs font-medium">{row.original.item.sku}</span>
          <p className="text-xs text-ink-muted">{row.original.item.productName}</p>
        </div>
      ),
    }),
    helper.accessor((row) => row.warehouse.code, {
      id: 'warehouse',
      meta: { label: 'Warehouse' },
      cell: ({ row }) => (
        <span className="font-mono text-xs" title={row.original.warehouse.name}>
          {row.original.warehouse.code}
        </span>
      ),
    }),
    helper.accessor('quantity', {
      meta: { label: 'Quantity', align: 'right' },
      cell: ({ getValue }) => (
        <span className="tabular-nums">{getValue().toLocaleString('en')}</span>
      ),
    }),
    helper.accessor('status', {
      meta: { label: 'Status' },
      cell: ({ row }) => (
        <Badge tone={RESERVATION_STATUS_LABELS[row.original.status].tone}>
          {RESERVATION_STATUS_LABELS[row.original.status].label}
        </Badge>
      ),
    }),
    helper.accessor('createdAt', {
      meta: { label: 'Created' },
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap">{formatDateTime(getValue())}</span>
      ),
    }),
    helper.accessor('releasedAt', {
      meta: { label: 'Released' },
      cell: ({ getValue }) => {
        const releasedAt = getValue();
        return (
          <span className="whitespace-nowrap">{releasedAt ? formatDateTime(releasedAt) : '—'}</span>
        );
      },
    }),
    helper.display({
      id: 'actions',
      meta: { label: 'Actions', align: 'right', alwaysVisible: true },
      cell: ({ row }) =>
        canRelease && row.original.status === 'ACTIVE' ? (
          <Button variant="secondary" size="sm" onClick={() => onRelease(row.original)}>
            Release
          </Button>
        ) : null,
    }),
  ];
}

function ReservationsView({ organizationId }: { organizationId: string }) {
  const notify = useToast();
  const { can } = usePermissions();
  const canRelease = can('inventory.reserve');
  const { params, update, reset } = useListParams(reservationParamsSchema);
  const reservations = useReservations(organizationId, {
    ...params,
    status: params.status === 'ALL' ? undefined : params.status,
  });
  const release = useReleaseReservation(organizationId);
  const [releasing, setReleasing] = useState<StockReservation | null>(null);
  const columns = useMemo(() => reservationColumns(canRelease, setReleasing), [canRelease]);
  const page = reservations.data;

  const confirmRelease = async (reservation: StockReservation) => {
    try {
      await release.mutateAsync(reservation.id);
      notify(
        `Released ${reservation.quantity} × ${reservation.item.sku} (${reservation.reference})`,
      );
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setReleasing(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Reservations"
        description="Stock held for a purpose so it cannot be promised twice. Releasing returns the units to available."
      />
      <DataTable
        label="Reservations"
        storageKey="inventory-reservations"
        columns={columns}
        data={page?.items}
        isLoading={reservations.isPending}
        isFetching={reservations.isFetching}
        error={reservations.error}
        onRetry={() => void reservations.refetch()}
        empty={
          params.search || params.status !== 'ACTIVE' ? (
            <EmptyState
              title="No reservations match"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No active reservations"
              description="Reserve stock from the stock list to hold units for a purpose."
            />
          )
        }
        toolbar={
          <>
            <SearchInput
              label="Search reference…"
              value={params.search ?? ''}
              onChange={(search) => update({ search: search || undefined })}
            />
            <select
              aria-label="Status"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
              value={params.status}
              onChange={(e) => update({ status: e.target.value as ReservationParams['status'] })}
            >
              {RESERVATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {RESERVATION_STATUS_LABELS[status].label}
                </option>
              ))}
              <option value="ALL">All statuses</option>
            </select>
          </>
        }
        footer={
          page && (
            <Pagination
              page={page.page}
              pageSize={page.pageSize}
              total={page.total}
              totalPages={page.totalPages}
              onPageChange={(next) => update({ page: next })}
              onPageSizeChange={(pageSize) => update({ pageSize })}
            />
          )
        }
      />
      <ConfirmDialog
        open={releasing !== null}
        title={releasing ? `Release “${releasing.reference}”?` : 'Release reservation?'}
        description={
          releasing
            ? `${releasing.quantity.toLocaleString('en')} × ${releasing.item.sku} in ${releasing.warehouse.code} become available again. This cannot be undone; reserve again if needed.`
            : ''
        }
        confirmLabel="Release"
        tone="primary"
        pending={release.isPending}
        onConfirm={() => releasing && void confirmRelease(releasing)}
        onCancel={() => setReleasing(null)}
      />
    </div>
  );
}

export default function ReservationsPage() {
  return (
    <RequireOrganization permission="inventory.read">
      {(organization) => (
        <Suspense fallback={<LoadingRows label="Loading reservations" />}>
          <ReservationsView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
