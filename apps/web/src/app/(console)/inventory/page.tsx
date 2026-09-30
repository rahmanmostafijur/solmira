'use client';

import {
  inventoryLevelListQuerySchema,
  type InventoryLevel,
  type InventoryLevelListQuery,
} from '@solmira/contracts';
import { ArrowLeftRight, BellRing, History, Lock, Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { formatDateTime } from '@/components/catalog/labels';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { AddStockDialog } from '@/components/inventory/add-stock-dialog';
import { AdjustStockDialog } from '@/components/inventory/adjust-stock-dialog';
import { FilterChip } from '@/components/inventory/filter-chip';
import { ReorderPointDialog } from '@/components/inventory/reorder-point-dialog';
import { ReserveStockDialog } from '@/components/inventory/reserve-stock-dialog';
import { TransferStockDialog } from '@/components/inventory/transfer-stock-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { PICK_LIST_SIZE, useWarehouses } from '@/lib/catalog-queries';
import { useInventoryLevels } from '@/lib/inventory-queries';
import { useListParams } from '@/lib/list-params';

/**
 * The API's own query schema, except that the low-stock toggle stays text in the URL ("true" or
 * absent), as every other list parameter does; it becomes a boolean only for the request.
 */
const levelParamsSchema = inventoryLevelListQuerySchema
  .omit({ lowStock: true })
  .extend({ lowStock: z.enum(['true']).optional() });
type LevelParams = z.output<typeof levelParamsSchema>;

type StockAction = 'adjust' | 'transfer' | 'reserve' | 'reorder';

const units = (n: number) => n.toLocaleString('en');
const helper = columnHelper<InventoryLevel>();

function RowAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" aria-label={label} title={label} onClick={onClick}>
      {icon}
    </Button>
  );
}

function stockColumns(
  { canAdjust, canReserve }: { canAdjust: boolean; canReserve: boolean },
  open: (action: StockAction, level: InventoryLevel) => void,
): DataColumn<InventoryLevel>[] {
  return [
    helper.accessor((row) => row.item.sku, {
      id: 'sku',
      meta: { label: 'SKU', sortKey: 'sku', alwaysVisible: true },
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium">{row.original.item.sku}</span>
      ),
    }),
    helper.accessor((row) => row.item.productName, {
      id: 'item',
      meta: { label: 'Product' },
      cell: ({ row }) => {
        const { item } = row.original;
        return (
          <div className="min-w-40">
            <Link
              href={`/products/${item.productId}`}
              className="font-medium text-ink hover:text-accent hover:underline"
            >
              {item.productName}
            </Link>
            {item.variantName !== item.productName && (
              <p className="text-xs text-ink-muted">{item.variantName}</p>
            )}
          </div>
        );
      },
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
    helper.accessor('onHand', {
      meta: { label: 'On hand', sortKey: 'onHand', align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{units(getValue())}</span>,
    }),
    helper.accessor('reserved', {
      meta: { label: 'Reserved', align: 'right' },
      cell: ({ getValue }) => (
        <span className="text-ink-muted tabular-nums">{units(getValue())}</span>
      ),
    }),
    helper.accessor('available', {
      meta: { label: 'Available', sortKey: 'available', align: 'right' },
      cell: ({ getValue }) => <span className="font-medium tabular-nums">{units(getValue())}</span>,
    }),
    helper.accessor('reorderPoint', {
      meta: { label: 'Reorder point', align: 'right' },
      cell: ({ getValue }) => {
        const value = getValue();
        return <span className="tabular-nums">{value === null ? '—' : units(value)}</span>;
      },
    }),
    helper.accessor('isLowStock', {
      meta: { label: 'Stock' },
      cell: ({ getValue }) => (getValue() ? <Badge tone="warn">Low stock</Badge> : null),
    }),
    helper.accessor('updatedAt', {
      meta: { label: 'Updated', sortKey: 'updatedAt' },
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap">{formatDateTime(getValue())}</span>
      ),
    }),
    helper.display({
      id: 'actions',
      meta: { label: 'Actions', align: 'right', alwaysVisible: true },
      cell: ({ row }) => {
        const level = row.original;
        const name = `${level.item.sku} in ${level.warehouse.code}`;
        const movements = `/inventory/movements?warehouseId=${level.warehouse.id}&variantId=${level.item.variantId}`;
        return (
          <div className="flex justify-end gap-0.5">
            {canAdjust && (
              <>
                <RowAction
                  label={`Adjust ${name}`}
                  icon={<SlidersHorizontal aria-hidden className="size-4" />}
                  onClick={() => open('adjust', level)}
                />
                <RowAction
                  label={`Transfer ${name}`}
                  icon={<ArrowLeftRight aria-hidden className="size-4" />}
                  onClick={() => open('transfer', level)}
                />
                <RowAction
                  label={`Set reorder point for ${name}`}
                  icon={<BellRing aria-hidden className="size-4" />}
                  onClick={() => open('reorder', level)}
                />
              </>
            )}
            {canReserve && (
              <RowAction
                label={`Reserve ${name}`}
                icon={<Lock aria-hidden className="size-4" />}
                onClick={() => open('reserve', level)}
              />
            )}
            <Link
              href={movements}
              aria-label={`Movements of ${name}`}
              title={`Movements of ${name}`}
              className="inline-flex items-center rounded-md px-2.5 py-1.5 text-ink-muted hover:bg-canvas hover:text-ink"
            >
              <History aria-hidden className="size-4" />
            </Link>
          </div>
        );
      },
    }),
  ];
}

function InventoryView({ organizationId }: { organizationId: string }) {
  const { can } = usePermissions();
  const canListWarehouses = can('warehouses.read');
  const { params, update, reset, defaults } = useListParams(levelParamsSchema);
  const query: Partial<InventoryLevelListQuery> = {
    ...params,
    lowStock: params.lowStock === 'true' ? true : undefined,
  };
  const levels = useInventoryLevels(organizationId, query);
  const warehouses = useWarehouses(
    organizationId,
    { pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    canListWarehouses,
  );
  const [active, setActive] = useState<{ action: StockAction; level: InventoryLevel } | null>(null);
  const [adding, setAdding] = useState(false);
  const page = levels.data;
  const first = page?.items[0];
  const close = () => setActive(null);
  const levelFor = (action: StockAction) => (active?.action === action ? active.level : null);

  const canAdjust = can('inventory.adjust');
  const canReserve = can('inventory.reserve');
  const columns = useMemo(
    () => stockColumns({ canAdjust, canReserve }, (action, level) => setActive({ action, level })),
    [canAdjust, canReserve],
  );

  const filtered = (Object.keys(params) as (keyof LevelParams)[]).some(
    (key) => key !== 'page' && key !== 'pageSize' && params[key] !== defaults[key],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Inventory"
        description="What is on hand, reserved and still available for every variant in every warehouse."
        actions={
          can('inventory.adjust', 'products.read') && (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" /> Add stock
            </Button>
          )
        }
      />
      <DataTable
        label="Stock levels"
        storageKey="inventory-levels"
        columns={columns}
        data={page?.items}
        isLoading={levels.isPending}
        isFetching={levels.isFetching}
        error={levels.error}
        onRetry={() => void levels.refetch()}
        sort={{ key: params.sort, direction: params.direction }}
        onSortChange={(sort) =>
          update({ sort: sort.key as LevelParams['sort'], direction: sort.direction })
        }
        empty={
          filtered ? (
            <EmptyState
              title="No stock matches these filters"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No stock yet"
              description="Add stock to receive units of a variant into a warehouse."
            />
          )
        }
        toolbar={
          <>
            <SearchInput
              label="Search SKU, variant, product…"
              value={params.search ?? ''}
              onChange={(search) => update({ search: search || undefined })}
            />
            {canListWarehouses && (
              <select
                aria-label="Warehouse"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={params.lowStock === 'true'}
                onChange={(e) => update({ lowStock: e.target.checked ? 'true' : undefined })}
              />
              Low stock only
            </label>
            {params.productId && (
              <FilterChip
                label={`Product: ${first?.item.productName ?? 'selected'}`}
                onClear={() => update({ productId: undefined })}
              />
            )}
            {params.variantId && (
              <FilterChip
                label={`Variant: ${first?.item.sku ?? 'selected'}`}
                onClear={() => update({ variantId: undefined })}
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
      <AdjustStockDialog
        organizationId={organizationId}
        level={levelFor('adjust')}
        onClose={close}
      />
      <TransferStockDialog
        organizationId={organizationId}
        level={levelFor('transfer')}
        onClose={close}
      />
      <ReserveStockDialog
        organizationId={organizationId}
        level={levelFor('reserve')}
        onClose={close}
      />
      <ReorderPointDialog
        organizationId={organizationId}
        level={levelFor('reorder')}
        onClose={close}
      />
      <AddStockDialog
        organizationId={organizationId}
        open={adding}
        initialWarehouseId={params.warehouseId}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}

export default function InventoryPage() {
  return (
    <RequireOrganization permission="inventory.read">
      {(organization) => (
        // useSearchParams needs a Suspense boundary so the page can still be prerendered.
        <Suspense fallback={<LoadingRows label="Loading stock" />}>
          <InventoryView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
