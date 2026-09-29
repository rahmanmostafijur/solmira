'use client';

import {
  WAREHOUSE_STATUSES,
  warehouseListQuerySchema,
  type Warehouse,
  type WarehouseListQuery,
} from '@solmira/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { PARTNER_STATUS_LABELS } from '@/components/catalog/labels';
import { WarehouseForm } from '@/components/catalog/warehouse-form';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useWarehouses } from '@/lib/catalog-queries';
import { useListParams } from '@/lib/list-params';

const helper = columnHelper<Warehouse>();
const COLUMNS: DataColumn<Warehouse>[] = [
  helper.accessor('code', {
    meta: { label: 'Code', sortKey: 'code', alwaysVisible: true },
    cell: ({ row }) => (
      <Link
        href={`/warehouses/${row.original.id}`}
        className="font-mono text-xs font-medium hover:text-accent hover:underline"
      >
        {row.original.code}
      </Link>
    ),
  }),
  helper.accessor('name', { meta: { label: 'Name', sortKey: 'name' } }),
  helper.accessor((row) => [row.city, row.country].filter(Boolean).join(', ') || null, {
    id: 'location',
    meta: { label: 'Location' },
    cell: ({ row }) => [row.original.city, row.original.country].filter(Boolean).join(', ') || '—',
  }),
  helper.accessor((row) => row.manager?.fullName ?? null, {
    id: 'manager',
    meta: { label: 'Manager' },
    cell: ({ row }) => row.original.manager?.fullName ?? '—',
  }),
  helper.accessor('status', {
    meta: { label: 'Status' },
    cell: ({ row }) => (
      <Badge tone={PARTNER_STATUS_LABELS[row.original.status].tone}>
        {PARTNER_STATUS_LABELS[row.original.status].label}
      </Badge>
    ),
  }),
];

function WarehousesView({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const notify = useToast();
  const { can } = usePermissions();
  const { params, update, reset } = useListParams(warehouseListQuerySchema);
  const warehouses = useWarehouses(organizationId, params);
  const [creating, setCreating] = useState(false);
  const page = warehouses.data;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Warehouses"
        description="Places where you keep stock. Each has a short code for labels and an optional manager from your team."
        actions={
          can('warehouses.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New warehouse
            </Button>
          )
        }
      />
      <DataTable
        label="Warehouses"
        storageKey="warehouses"
        columns={COLUMNS}
        data={page?.items}
        isLoading={warehouses.isPending}
        isFetching={warehouses.isFetching}
        error={warehouses.error}
        onRetry={() => void warehouses.refetch()}
        sort={{ key: params.sort, direction: params.direction }}
        onSortChange={(sort) =>
          update({ sort: sort.key as WarehouseListQuery['sort'], direction: sort.direction })
        }
        empty={
          params.search || params.status ? (
            <EmptyState
              title="No warehouses match"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No warehouses yet"
              description="Add your first location to start tracking where stock lives."
            />
          )
        }
        toolbar={
          <>
            <SearchInput
              label="Search code, name, city…"
              value={params.search ?? ''}
              onChange={(search) => update({ search: search || undefined })}
            />
            <select
              aria-label="Status"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
              value={params.status ?? ''}
              onChange={(e) =>
                update({ status: (e.target.value || undefined) as WarehouseListQuery['status'] })
              }
            >
              <option value="">All statuses</option>
              {WAREHOUSE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PARTNER_STATUS_LABELS[status].label}
                </option>
              ))}
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
      <Dialog open={creating} title="New warehouse" size="lg" onClose={() => setCreating(false)}>
        <WarehouseForm
          organizationId={organizationId}
          onCancel={() => setCreating(false)}
          onSaved={(warehouse) => {
            notify(`Warehouse ${warehouse.code} created`);
            router.push(`/warehouses/${warehouse.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}

export default function WarehousesPage() {
  return (
    <RequireOrganization permission="warehouses.read">
      {(organization) => (
        <Suspense fallback={<LoadingRows label="Loading warehouses" />}>
          <WarehousesView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
