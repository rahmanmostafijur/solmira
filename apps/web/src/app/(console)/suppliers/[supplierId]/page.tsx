'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { PARTNER_STATUS_LABELS, PRODUCT_STATUS_LABELS } from '@/components/catalog/labels';
import { SupplierForm } from '@/components/catalog/supplier-form';
import { SupplierPurchasingPanel } from '@/components/purchasing/supplier-purchasing-panel';
import { Pagination } from '@/components/data-table/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { ApiError, describeError } from '@/lib/api/client';
import { useProducts, useSupplier, useUpdateSupplier } from '@/lib/catalog-queries';
import { formatMoney } from '@/lib/money';

function SupplierProducts({
  organizationId,
  supplierId,
}: {
  organizationId: string;
  supplierId: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const products = useProducts(organizationId, {
    supplierId,
    page,
    pageSize,
    sort: 'name',
    direction: 'asc',
  });
  if (products.isPending) return <LoadingRows label="Loading products" />;
  if (products.isError)
    return (
      <div className="p-4">
        <Alert tone="error">{describeError(products.error)}</Alert>
      </div>
    );
  const data = products.data;
  if (data.total === 0) return <EmptyState title="No products from this supplier yet" />;
  return (
    <>
      <ul className="divide-y divide-line">
        {data.items.map((product) => (
          <li
            key={product.id}
            className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
          >
            <Link
              href={`/products/${product.id}`}
              className="font-medium hover:text-accent hover:underline"
            >
              {product.name}
            </Link>
            <span className="flex items-center gap-3">
              <span className="tabular-nums text-ink-muted">
                {formatMoney(product.basePrice, product.currency)}
              </span>
              <Badge tone={PRODUCT_STATUS_LABELS[product.status].tone}>
                {PRODUCT_STATUS_LABELS[product.status].label}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        totalPages={data.totalPages}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </>
  );
}

function SupplierView({
  organizationId,
  supplierId,
}: {
  organizationId: string;
  supplierId: string;
}) {
  const notify = useToast();
  const { can } = usePermissions();
  const supplier = useSupplier(organizationId, supplierId);
  const update = useUpdateSupplier(organizationId, supplierId);

  if (supplier.isPending) return <LoadingRows rows={6} label="Loading supplier" />;
  if (supplier.isError) {
    return supplier.error instanceof ApiError &&
      (supplier.error.status === 404 || supplier.error.status === 400) ? (
      <EmptyState
        title="Supplier not found"
        action={
          <Link href="/suppliers" className="text-sm font-medium text-accent hover:underline">
            Back to suppliers
          </Link>
        }
      />
    ) : (
      <Alert tone="error">{describeError(supplier.error)}</Alert>
    );
  }
  const s = supplier.data;
  const next = s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const toggle = async () => {
    try {
      await update.mutateAsync({ status: next });
      notify(next === 'ACTIVE' ? 'Supplier reactivated' : 'Supplier deactivated');
    } catch (error) {
      notify(describeError(error), 'error');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="mb-2 text-sm">
          <Link href="/suppliers" className="text-ink-muted hover:text-ink">
            ← Suppliers
          </Link>
        </p>
        <PageHeader
          title={s.companyName}
          description={[s.contactName, s.email, s.country].filter(Boolean).join(' · ') || undefined}
          actions={
            <div className="flex items-center gap-3">
              <Badge tone={PARTNER_STATUS_LABELS[s.status].tone}>
                {PARTNER_STATUS_LABELS[s.status].label}
              </Badge>
              {can('purchase_orders.create') && s.status === 'ACTIVE' && (
                <Link
                  href={`/purchase-orders/new?supplierId=${s.id}`}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  New purchase order
                </Link>
              )}
              {can('suppliers.update') && (
                <Button
                  variant="secondary"
                  loading={update.isPending}
                  onClick={() => void toggle()}
                >
                  {next === 'ACTIVE' ? 'Reactivate' : 'Deactivate'}
                </Button>
              )}
            </div>
          }
        />
      </div>
      <Panel title="Details">
        <div className="p-5">
          <SupplierForm
            key={s.updatedAt}
            organizationId={organizationId}
            supplier={s}
            readOnly={!can('suppliers.update')}
            onSaved={() => notify('Supplier saved')}
          />
        </div>
      </Panel>
      {can('products.read') && (
        <Panel
          title="Products"
          description={`${s.productCount} product${s.productCount === 1 ? '' : 's'} supplied`}
        >
          <SupplierProducts organizationId={organizationId} supplierId={s.id} />
        </Panel>
      )}
      {can('purchase_orders.read') && (
        <SupplierPurchasingPanel organizationId={organizationId} supplierId={s.id} />
      )}
    </div>
  );
}

export default function SupplierPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  return (
    <RequireOrganization permission="suppliers.read">
      {(organization) => <SupplierView organizationId={organization.id} supplierId={supplierId} />}
    </RequireOrganization>
  );
}
