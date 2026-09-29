'use client';

import {
  SUPPLIER_STATUSES,
  supplierListQuerySchema,
  type Supplier,
  type SupplierListQuery,
} from '@solmira/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { PARTNER_STATUS_LABELS, PAYMENT_TERMS_LABELS } from '@/components/catalog/labels';
import { SupplierForm } from '@/components/catalog/supplier-form';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useSuppliers } from '@/lib/catalog-queries';
import { useListParams } from '@/lib/list-params';

const helper = columnHelper<Supplier>();
const COLUMNS: DataColumn<Supplier>[] = [
  helper.accessor('companyName', {
    meta: { label: 'Company', sortKey: 'companyName', alwaysVisible: true },
    cell: ({ row }) => (
      <Link
        href={`/suppliers/${row.original.id}`}
        className="font-medium hover:text-accent hover:underline"
      >
        {row.original.companyName}
      </Link>
    ),
  }),
  helper.accessor('contactName', {
    meta: { label: 'Contact' },
    cell: ({ getValue }) => getValue() ?? '—',
  }),
  helper.accessor('email', { meta: { label: 'Email' }, cell: ({ getValue }) => getValue() ?? '—' }),
  helper.accessor('country', {
    meta: { label: 'Country' },
    cell: ({ getValue }) => getValue() ?? '—',
  }),
  helper.accessor('leadTimeDays', {
    meta: { label: 'Lead time', sortKey: 'leadTimeDays', align: 'right' },
    cell: ({ getValue }) => `${getValue()} d`,
  }),
  helper.accessor('paymentTerms', {
    meta: { label: 'Terms' },
    cell: ({ row }) => PAYMENT_TERMS_LABELS[row.original.paymentTerms],
  }),
  helper.accessor('productCount', {
    meta: { label: 'Products', align: 'right' },
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
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

function SuppliersView({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const notify = useToast();
  const { can } = usePermissions();
  const { params, update, reset } = useListParams(supplierListQuerySchema);
  const suppliers = useSuppliers(organizationId, params);
  const [creating, setCreating] = useState(false);
  const page = suppliers.data;
  const filtered = Boolean(params.search || params.status || params.country);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Suppliers"
        description="Companies you buy from. Inactive suppliers stay on existing products but cannot be chosen for new ones."
        actions={
          can('suppliers.create') && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-4" /> New supplier
            </Button>
          )
        }
      />
      <DataTable
        label="Suppliers"
        storageKey="suppliers"
        columns={COLUMNS}
        data={page?.items}
        isLoading={suppliers.isPending}
        isFetching={suppliers.isFetching}
        error={suppliers.error}
        onRetry={() => void suppliers.refetch()}
        sort={{ key: params.sort, direction: params.direction }}
        onSortChange={(sort) =>
          update({ sort: sort.key as SupplierListQuery['sort'], direction: sort.direction })
        }
        empty={
          filtered ? (
            <EmptyState
              title="No suppliers match"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No suppliers yet"
              description="Add the companies you buy stock from."
            />
          )
        }
        toolbar={
          <>
            <SearchInput
              label="Search company, contact, email…"
              value={params.search ?? ''}
              onChange={(search) => update({ search: search || undefined })}
            />
            <select
              aria-label="Status"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
              value={params.status ?? ''}
              onChange={(e) =>
                update({ status: (e.target.value || undefined) as SupplierListQuery['status'] })
              }
            >
              <option value="">All statuses</option>
              {SUPPLIER_STATUSES.map((status) => (
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
      <Dialog open={creating} title="New supplier" size="lg" onClose={() => setCreating(false)}>
        <SupplierForm
          organizationId={organizationId}
          onCancel={() => setCreating(false)}
          onSaved={(supplier) => {
            notify(`“${supplier.companyName}” added`);
            router.push(`/suppliers/${supplier.id}`);
          }}
        />
      </Dialog>
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <RequireOrganization permission="suppliers.read">
      {(organization) => (
        <Suspense fallback={<LoadingRows label="Loading suppliers" />}>
          <SuppliersView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
