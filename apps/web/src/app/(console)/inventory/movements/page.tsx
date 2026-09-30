'use client';

import {
  INVENTORY_MOVEMENT_TYPES,
  inventoryMovementListQuerySchema,
  type InventoryMovement,
  type InventoryMovementListQuery,
} from '@solmira/contracts';
import Link from 'next/link';
import { Suspense } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { formatDateTime } from '@/components/catalog/labels';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { FilterChip } from '@/components/inventory/filter-chip';
import {
  ADJUSTMENT_REASON_LABELS,
  MOVEMENT_TYPE_LABELS,
  formatQuantityChange,
  quantityChangeClass,
} from '@/components/inventory/labels';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { PICK_LIST_SIZE, useWarehouses } from '@/lib/catalog-queries';
import { useMovements } from '@/lib/inventory-queries';
import { useListParams } from '@/lib/list-params';

const units = (n: number) => n.toLocaleString('en');

function SignedQuantity({ value }: { value: number }) {
  return (
    <span className={`font-medium tabular-nums ${quantityChangeClass(value)}`}>
      {formatQuantityChange(value)}
    </span>
  );
}

const helper = columnHelper<InventoryMovement>();
const COLUMNS: DataColumn<InventoryMovement>[] = [
  helper.accessor('createdAt', {
    meta: { label: 'Time', alwaysVisible: true },
    cell: ({ getValue }) => (
      <time dateTime={getValue()} className="whitespace-nowrap">
        {formatDateTime(getValue())}
      </time>
    ),
  }),
  helper.accessor('type', {
    meta: { label: 'Type' },
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{MOVEMENT_TYPE_LABELS[row.original.type]}</span>
    ),
  }),
  helper.accessor('reason', {
    meta: { label: 'Reason' },
    cell: ({ row }) => (row.original.reason ? ADJUSTMENT_REASON_LABELS[row.original.reason] : '—'),
  }),
  helper.accessor((row) => row.item.sku, {
    id: 'sku',
    meta: { label: 'SKU' },
    cell: ({ row }) => (
      <div className="min-w-32">
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
  helper.accessor('onHandChange', {
    meta: { label: 'On hand', align: 'right' },
    cell: ({ getValue }) => <SignedQuantity value={getValue()} />,
  }),
  helper.accessor('reservedChange', {
    meta: { label: 'Reserved', align: 'right' },
    cell: ({ getValue }) => <SignedQuantity value={getValue()} />,
  }),
  helper.accessor('onHandAfter', {
    id: 'balance',
    meta: { label: 'Balance after', align: 'right' },
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-ink-muted tabular-nums">
        {units(row.original.onHandAfter)} on hand · {units(row.original.reservedAfter)} reserved
      </span>
    ),
  }),
  helper.accessor('note', {
    meta: { label: 'Note' },
    cell: ({ getValue }) => (
      <span className="line-clamp-2 max-w-64 text-ink-muted">{getValue() ?? '—'}</span>
    ),
  }),
];

function MovementsView({ organizationId }: { organizationId: string }) {
  const { can } = usePermissions();
  const canListWarehouses = can('warehouses.read');
  const { params, update, reset } = useListParams(inventoryMovementListQuerySchema);
  const movements = useMovements(organizationId, params);
  const warehouses = useWarehouses(
    organizationId,
    { pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    canListWarehouses,
  );
  const page = movements.data;
  const control = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';
  const filtered = Boolean(
    params.warehouseId || params.variantId || params.type || params.from || params.to,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Stock movements"
        description="The ledger of every stock change, newest first. Entries are never edited; a mistake is fixed by a new adjustment."
        actions={
          <Link href="/inventory" className="text-sm font-medium text-accent hover:underline">
            Back to stock
          </Link>
        }
      />
      <DataTable
        label="Stock movements"
        storageKey="inventory-movements"
        columns={COLUMNS}
        data={page?.items}
        isLoading={movements.isPending}
        isFetching={movements.isFetching}
        error={movements.error}
        onRetry={() => void movements.refetch()}
        empty={
          filtered ? (
            <EmptyState
              title="No movements match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No movements yet"
              description="Adjustments, transfers and reservations appear here as they happen."
            />
          )
        }
        toolbar={
          <>
            {canListWarehouses && (
              <select
                aria-label="Warehouse"
                className={control}
                value={params.warehouseId ?? ''}
                onChange={(e) => update({ warehouseId: e.target.value || undefined })}
              >
                <option value="">All warehouses</option>
                {(warehouses.data?.items ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Type"
              className={control}
              value={params.type ?? ''}
              onChange={(e) =>
                update({
                  type: (e.target.value || undefined) as InventoryMovementListQuery['type'],
                })
              }
            >
              <option value="">All types</option>
              {INVENTORY_MOVEMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {MOVEMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              From
              <input
                type="date"
                className={control}
                value={params.from ?? ''}
                max={params.to}
                onChange={(e) => update({ from: e.target.value || undefined })}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              to
              <input
                type="date"
                className={control}
                value={params.to ?? ''}
                min={params.from}
                onChange={(e) => update({ to: e.target.value || undefined })}
              />
            </label>
            {params.variantId && (
              <FilterChip
                label={`Variant: ${page?.items[0]?.item.sku ?? 'selected'}`}
                onClear={() => update({ variantId: undefined })}
              />
            )}
            {params.warehouseId && !canListWarehouses && (
              <FilterChip
                label={`Warehouse: ${page?.items[0]?.warehouse.code ?? 'selected'}`}
                onClear={() => update({ warehouseId: undefined })}
              />
            )}
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
    </div>
  );
}

export default function MovementsPage() {
  return (
    <RequireOrganization permission="inventory.read">
      {(organization) => (
        <Suspense fallback={<LoadingRows label="Loading movements" />}>
          <MovementsView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
