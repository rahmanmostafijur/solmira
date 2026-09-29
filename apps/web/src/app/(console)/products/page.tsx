'use client';

import {
  PRODUCT_STATUSES,
  productListQuerySchema,
  type BulkProductStatusRequest,
  type ProductListQuery,
  type ProductSummary,
} from '@solmira/contracts';
import type { RowSelectionState } from '@tanstack/react-table';
import { Plus, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { categoryOptions } from '@/components/catalog/category-tree';
import { PRODUCT_STATUS_LABELS, formatDate } from '@/components/catalog/labels';
import { DataTable, columnHelper, type DataColumn } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import { SearchInput } from '@/components/data-table/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import {
  PICK_LIST_SIZE,
  useBulkProductStatus,
  useCategories,
  useProducts,
  useSuppliers,
} from '@/lib/catalog-queries';
import { useListParams } from '@/lib/list-params';
import { formatMoney, fromMinorUnits, toMinorUnits } from '@/lib/money';
import { useOrganization } from '@/lib/queries';

const helper = columnHelper<ProductSummary>();
const COLUMNS: DataColumn<ProductSummary>[] = [
  helper.accessor('name', {
    meta: { label: 'Product', sortKey: 'name', alwaysVisible: true },
    cell: ({ row }) => (
      <div className="min-w-48">
        <Link
          href={`/products/${row.original.id}`}
          className="font-medium text-ink hover:text-accent hover:underline"
        >
          {row.original.name}
        </Link>
        {row.original.brand && <p className="text-xs text-ink-muted">{row.original.brand}</p>}
      </div>
    ),
  }),
  helper.accessor('primarySku', {
    meta: { label: 'SKU' },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.primarySku ?? '—'}</span>,
  }),
  helper.accessor('status', {
    meta: { label: 'Status' },
    cell: ({ row }) => (
      <Badge tone={PRODUCT_STATUS_LABELS[row.original.status].tone}>
        {PRODUCT_STATUS_LABELS[row.original.status].label}
      </Badge>
    ),
  }),
  helper.accessor((row) => row.category?.name ?? null, {
    id: 'category',
    meta: { label: 'Category' },
    cell: ({ row }) => row.original.category?.name ?? '—',
  }),
  helper.accessor((row) => row.supplier?.companyName ?? null, {
    id: 'supplier',
    meta: { label: 'Supplier' },
    cell: ({ row }) =>
      row.original.supplier ? (
        <Link
          href={`/suppliers/${row.original.supplier.id}`}
          className="hover:text-accent hover:underline"
        >
          {row.original.supplier.companyName}
        </Link>
      ) : (
        '—'
      ),
  }),
  helper.accessor('variantCount', {
    meta: { label: 'Variants', align: 'right' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.variantCount}</span>,
  }),
  helper.accessor('basePrice', {
    meta: { label: 'Base price', sortKey: 'basePrice', align: 'right' },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {formatMoney(row.original.basePrice, row.original.currency)}
      </span>
    ),
  }),
  helper.accessor('updatedAt', {
    meta: { label: 'Updated', sortKey: 'updatedAt' },
    cell: ({ row }) => formatDate(row.original.updatedAt),
  }),
  helper.accessor('createdAt', {
    meta: { label: 'Created', sortKey: 'createdAt' },
    cell: ({ row }) => formatDate(row.original.createdAt),
  }),
];

type BulkStatus = BulkProductStatusRequest['status'];
const BULK_ACTIONS: { status: BulkStatus; label: string }[] = [
  { status: 'ACTIVE', label: 'Activate' },
  { status: 'INACTIVE', label: 'Deactivate' },
  { status: 'ARCHIVED', label: 'Archive' },
];

interface FiltersProps {
  organizationId: string;
  currency: string;
  params: ProductListQuery;
  update: (patch: Partial<ProductListQuery>) => void;
}

function Filters({ organizationId, currency, params, update }: FiltersProps) {
  const [open, setOpen] = useState(
    Boolean(
      params.brand ||
      params.sku ||
      params.minPrice ||
      params.maxPrice ||
      params.createdFrom ||
      params.createdTo,
    ),
  );
  const categories = useCategories(organizationId);
  const suppliers = useSuppliers(organizationId, {
    pageSize: PICK_LIST_SIZE,
    sort: 'companyName',
    direction: 'asc',
  });
  const control = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';
  // Prices are typed in the organization's currency and sent as minor units, like stored prices.
  const price = (value: string) =>
    value.trim() === '' ? undefined : (toMinorUnits(value, currency) ?? undefined);

  return (
    <>
      <SearchInput
        label="Search name, SKU, brand…"
        value={params.search ?? ''}
        onChange={(search) => update({ search: search || undefined })}
      />
      <select
        aria-label="Status"
        className={control}
        value={params.status ?? ''}
        onChange={(e) =>
          update({ status: (e.target.value || undefined) as ProductListQuery['status'] })
        }
      >
        <option value="">All statuses</option>
        {PRODUCT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {PRODUCT_STATUS_LABELS[status].label}
          </option>
        ))}
      </select>
      <select
        aria-label="Category"
        className={control}
        value={params.categoryId ?? ''}
        onChange={(e) => update({ categoryId: e.target.value || undefined })}
      >
        <option value="">All categories</option>
        {categoryOptions(categories.data?.items ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Supplier"
        className={control}
        value={params.supplierId ?? ''}
        onChange={(e) => update({ supplierId: e.target.value || undefined })}
      >
        <option value="">All suppliers</option>
        {(suppliers.data?.items ?? []).map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.companyName}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden className="size-4" /> More filters
      </Button>
      {open && (
        <div className="flex w-full flex-wrap items-end gap-2 pt-1">
          <input
            aria-label="Brand"
            placeholder="Brand"
            className={control}
            defaultValue={params.brand ?? ''}
            onBlur={(e) => update({ brand: e.target.value.trim() || undefined })}
          />
          <input
            aria-label="Exact SKU"
            placeholder="Exact SKU"
            className={control}
            defaultValue={params.sku ?? ''}
            onBlur={(e) => update({ sku: e.target.value.trim() || undefined })}
          />
          <input
            aria-label="Minimum price"
            placeholder="Min price"
            inputMode="decimal"
            className={`${control} w-28`}
            defaultValue={
              params.minPrice !== undefined ? fromMinorUnits(params.minPrice, currency) : ''
            }
            onBlur={(e) => update({ minPrice: price(e.target.value) })}
          />
          <input
            aria-label="Maximum price"
            placeholder="Max price"
            inputMode="decimal"
            className={`${control} w-28`}
            defaultValue={
              params.maxPrice !== undefined ? fromMinorUnits(params.maxPrice, currency) : ''
            }
            onBlur={(e) => update({ maxPrice: price(e.target.value) })}
          />
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            Created from
            <input
              type="date"
              className={control}
              value={params.createdFrom ?? ''}
              onChange={(e) => update({ createdFrom: e.target.value || undefined })}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-muted">
            to
            <input
              type="date"
              className={control}
              value={params.createdTo ?? ''}
              onChange={(e) => update({ createdTo: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
    </>
  );
}

function ProductsView({ organizationId }: { organizationId: string }) {
  const notify = useToast();
  const { can } = usePermissions();
  const { params, update, reset, defaults } = useListParams(productListQuerySchema);
  const products = useProducts(organizationId, params);
  const bulk = useBulkProductStatus(organizationId);
  const currency = useOrganization(organizationId).data?.currency ?? 'USD';
  const [pending, setPending] = useState<BulkStatus | null>(null);
  const canUpdate = can('products.update');

  // A selection belongs to the rows on screen: it is stored with the list parameters it was made
  // under, so a new page, sort or filter starts with nothing selected.
  const paramsKey = JSON.stringify(params);
  const [selected, setSelected] = useState<{ key: string; rows: RowSelectionState }>({
    key: paramsKey,
    rows: {},
  });
  const selection = selected.key === paramsKey ? selected.rows : {};
  const setSelection = (rows: RowSelectionState) => setSelected({ key: paramsKey, rows });
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  const filtered = useMemo(
    () =>
      (Object.keys(params) as (keyof ProductListQuery)[]).some(
        (key) => key !== 'page' && key !== 'pageSize' && params[key] !== defaults[key],
      ),
    [params, defaults],
  );

  const runBulk = async (status: BulkStatus) => {
    try {
      const result = await bulk.mutateAsync({ productIds: selectedIds, status });
      const skipped = result.skipped.length;
      const firstReason = result.skipped[0]?.reason ?? '';
      notify(
        `${result.updated.length} updated${skipped ? `, ${skipped} skipped: ${firstReason}${skipped > 1 ? ' (and others)' : ''}` : ''}`,
        skipped ? 'info' : 'success',
      );
      setSelection({});
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setPending(null);
    }
  };

  const page = products.data;
  const pendingLabel = BULK_ACTIONS.find((action) => action.status === pending)?.label ?? 'Update';

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Products"
        description="Everything you sell. Each product has one or more variants with their own SKU."
        actions={
          can('products.create') && (
            <Link
              href="/products/new"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              <Plus aria-hidden className="size-4" /> New product
            </Link>
          )
        }
      />
      <DataTable
        label="Products"
        storageKey="products"
        columns={COLUMNS}
        data={page?.items}
        isLoading={products.isPending}
        isFetching={products.isFetching}
        error={products.error}
        onRetry={() => void products.refetch()}
        sort={{ key: params.sort, direction: params.direction }}
        onSortChange={(sort) =>
          update({ sort: sort.key as ProductListQuery['sort'], direction: sort.direction })
        }
        selection={canUpdate ? selection : undefined}
        onSelectionChange={canUpdate ? setSelection : undefined}
        empty={
          filtered ? (
            <EmptyState
              title="No products match these filters"
              action={
                <Button variant="secondary" size="sm" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No products yet"
              description="Create your first product, then add variants and images."
              action={
                can('products.create') && (
                  <Link
                    href="/products/new"
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Create a product
                  </Link>
                )
              }
            />
          )
        }
        toolbar={
          selectedIds.length > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2"
              role="toolbar"
              aria-label="Bulk actions"
            >
              <span className="text-sm font-medium">{selectedIds.length} selected</span>
              {BULK_ACTIONS.map((action) => (
                <Button
                  key={action.status}
                  variant={action.status === 'ARCHIVED' ? 'danger' : 'secondary'}
                  size="sm"
                  loading={bulk.isPending && pending === action.status}
                  onClick={() => setPending(action.status)}
                >
                  {action.label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setSelection({})}>
                Clear selection
              </Button>
            </div>
          ) : (
            <Filters
              organizationId={organizationId}
              currency={currency}
              params={params}
              update={update}
            />
          )
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
        open={pending !== null}
        title={`${pendingLabel} ${selectedIds.length} product${selectedIds.length === 1 ? '' : 's'}?`}
        description={
          pending === 'ARCHIVED'
            ? 'Archived products can no longer be sold. You can restore them later.'
            : 'Products that cannot make this change (for example, with no active variant) are skipped and reported.'
        }
        confirmLabel="Apply"
        tone={pending === 'ARCHIVED' ? 'danger' : 'primary'}
        pending={bulk.isPending}
        onConfirm={() => pending && void runBulk(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <RequireOrganization permission="products.read">
      {(organization) => (
        // useSearchParams needs a Suspense boundary so the page can still be prerendered.
        <Suspense fallback={<LoadingRows label="Loading products" />}>
          <ProductsView organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
