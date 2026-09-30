'use client';

import {
  PURCHASE_ORDER_STATUSES,
  isPurchaseOrderReceivable,
  purchaseOrderListQuerySchema,
  type PurchaseOrderListQuery,
  type PurchaseOrderSummary,
} from '@solmira/contracts';
import { Eye, PackageCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { formatDate } from '@/components/catalog/labels';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { FilterChip } from '@/components/inventory/filter-chip';
import {
  PURCHASE_ORDER_STATUS_LABELS,
  formatDeliveryDate,
  isDeliveryOverdue,
  localToday,
} from '@/components/purchasing/labels';
import { PurchaseOrderStatusBadge } from '@/components/purchasing/status-badge';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { PICK_LIST_SIZE, useSuppliers, useWarehouses } from '@/lib/catalog-queries';
import { useListParams } from '@/lib/list-params';
import { formatMoney } from '@/lib/money';
import { usePurchaseOrders } from '@/lib/purchasing-queries';

const helper = columnHelper<PurchaseOrderSummary>();
const ICON_LINK =
  'inline-flex items-center rounded-md px-2.5 py-1.5 text-ink-muted hover:bg-canvas hover:text-ink';

function orderColumns({
  canReceive,
  today,
}: {
  canReceive: boolean;
  today: string;
}): DataColumn<PurchaseOrderSummary>[] {
  return [
    helper.accessor('number', {
      meta: { label: 'PO number', sortKey: 'number', alwaysVisible: true },
      cell: ({ row }) => (
        <Link
          href={`/purchase-orders/${row.original.id}`}
          className="font-mono text-xs font-medium whitespace-nowrap text-ink hover:text-accent hover:underline"
        >
          {row.original.number}
        </Link>
      ),
    }),
    helper.accessor((row) => row.supplier.companyName, {
      id: 'supplier',
      meta: { label: 'Supplier' },
      cell: ({ row }) => (
        <span className="block min-w-32 font-medium">{row.original.supplier.companyName}</span>
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
    helper.accessor('status', {
      meta: { label: 'Status' },
      cell: ({ getValue }) => <PurchaseOrderStatusBadge status={getValue()} />,
    }),
    helper.accessor('itemCount', {
      meta: { label: 'Items', align: 'right' },
      cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
    }),
    helper.accessor('total', {
      meta: { label: 'Total', sortKey: 'total', align: 'right' },
      cell: ({ row }) => (
        <span className="font-medium whitespace-nowrap tabular-nums">
          {formatMoney(row.original.total, row.original.currency)}
        </span>
      ),
    }),
    helper.accessor('expectedDeliveryDate', {
      meta: { label: 'Expected delivery', sortKey: 'expectedDeliveryDate' },
      cell: ({ row }) => {
        const { expectedDeliveryDate: date, status } = row.original;
        if (!date) return <span className="text-ink-muted">—</span>;
        const overdue = isDeliveryOverdue(date, status, today);
        return (
          <span className={overdue ? 'whitespace-nowrap text-danger' : 'whitespace-nowrap'}>
            {formatDeliveryDate(date)}
            {overdue && <span className="block text-xs">Overdue</span>}
          </span>
        );
      },
    }),
    helper.accessor('createdAt', {
      meta: { label: 'Created', sortKey: 'createdAt' },
      cell: ({ getValue }) => (
        <time dateTime={getValue()} className="whitespace-nowrap">
          {formatDate(getValue())}
        </time>
      ),
    }),
    helper.display({
      id: 'actions',
      meta: { label: 'Actions', align: 'right', alwaysVisible: true },
      cell: ({ row }) => {
        const order = row.original;
        return (
          <div className="flex justify-end gap-0.5">
            <Link
              href={`/purchase-orders/${order.id}`}
              aria-label={`View ${order.number}`}
              title={`View ${order.number}`}
              className={ICON_LINK}
            >
              <Eye aria-hidden className="size-4" />
            </Link>
            {canReceive && isPurchaseOrderReceivable(order.status) && (
              <Link
                href={`/purchase-orders/${order.id}/receive`}
                aria-label={`Receive ${order.number}`}
                title={`Receive ${order.number}`}
                className={ICON_LINK}
              >
                <PackageCheck aria-hidden className="size-4" />
              </Link>
            )}
          </div>
        );
      },
    }),
  ];
}

type OrderParams = PurchaseOrderListQuery;

function PurchaseOrdersView({ organizationId }: { organizationId: string }) {
  const { can } = usePermissions();
  const canListSuppliers = can('suppliers.read');
  const canListWarehouses = can('warehouses.read');
  const canReceive = can('purchase_orders.receive');
  const { params, update, reset, defaults } = useListParams(purchaseOrderListQuerySchema);
  const orders = usePurchaseOrders(organizationId, params);
  const suppliers = useSuppliers(
    organizationId,
    { pageSize: PICK_LIST_SIZE, sort: 'companyName', direction: 'asc' },
    canListSuppliers,
  );
  const warehouses = useWarehouses(
    organizationId,
    { pageSize: PICK_LIST_SIZE, sort: 'code', direction: 'asc' },
    canListWarehouses,
  );
  const today = localToday();
  const columns = useMemo(() => orderColumns({ canReceive, today }), [canReceive, today]);
  const page = orders.data;
  const first = page?.items[0];
  const control = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

  const filtered = (Object.keys(params) as (keyof OrderParams)[]).some(
    (key) => key !== 'page' && key !== 'pageSize' && params[key] !== defaults[key],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Purchase orders"
        description="What is ordered from suppliers, where it is in approval, and how much has arrived."
        actions={
          can('purchase_orders.create') && (
            <Link
              href="/purchase-orders/new"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <Plus aria-hidden className="size-4" /> New purchase order
            </Link>
          )
        }
      />
      <DataTable
        label="Purchase orders"
        storageKey="purchase-orders"
        columns={columns}
        data={page?.items}
        isLoading={orders.isPending}
        isFetching={orders.isFetching}
        error={orders.error}
        onRetry={() => void orders.refetch()}
        sort={{ key: params.sort, direction: params.direction }}
        onSortChange={(sort) =>
          update({ sort: sort.key as OrderParams['sort'], direction: sort.direction })
        }
        empty={
          filtered ? (
            <EmptyState
              title="No purchase orders match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No purchase orders yet"
              description="Create a purchase order to buy stock from a supplier and receive it into a warehouse."
            />
          )
        }
        toolbar={
          <>
            <SearchInput
              label="Search PO number or supplier…"
              value={params.search ?? ''}
              onChange={(search) => update({ search: search || undefined })}
            />
            <select
              aria-label="Status"
              className={control}
              value={params.status ?? ''}
              onChange={(e) =>
                update({ status: (e.target.value || undefined) as OrderParams['status'] })
              }
            >
              <option value="">All statuses</option>
              {PURCHASE_ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PURCHASE_ORDER_STATUS_LABELS[status].label}
                </option>
              ))}
            </select>
            {canListSuppliers && (
              <select
                aria-label="Supplier"
                className={control}
                value={params.supplierId ?? ''}
                onChange={(e) => update({ supplierId: e.target.value || undefined })}
              >
                <option value="">All suppliers</option>
                {(suppliers.data?.items ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                  </option>
                ))}
              </select>
            )}
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
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              Created from
              <input
                type="date"
                className={control}
                value={params.createdFrom ?? ''}
                max={params.createdTo}
                onChange={(e) => update({ createdFrom: e.target.value || undefined })}
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-ink-muted">
              to
              <input
                type="date"
                className={control}
                value={params.createdTo ?? ''}
                min={params.createdFrom}
                onChange={(e) => update({ createdTo: e.target.value || undefined })}
              />
            </label>
            {params.supplierId && !canListSuppliers && (
              <FilterChip
                label={`Supplier: ${first?.supplier.companyName ?? 'selected'}`}
                onClear={() => update({ supplierId: undefined })}
              />
            )}
            {params.warehouseId && !canListWarehouses && (
              <FilterChip
                label={`Warehouse: ${first?.warehouse.code ?? 'selected'}`}
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

export default function PurchaseOrdersPage() {
  return (
    <RequireOrganization permission="purchase_orders.read">
      {(organization) => (
        // useSearchParams needs a Suspense boundary so the page can still be prerendered.
        <Suspense fallback={<LoadingRows label="Loading purchase orders" />}>
          <PurchaseOrdersView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
