'use client';

import type { ProductDetail, ProductStatus } from '@solmira/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { ImagesPanel } from '@/components/catalog/images-panel';
import {
  PARTNER_STATUS_LABELS,
  PAYMENT_TERMS_LABELS,
  PRODUCT_STATUS_LABELS,
  formatDateTime,
  productStatusActions,
} from '@/components/catalog/labels';
import { ProductForm } from '@/components/catalog/product-form';
import { VariantsPanel } from '@/components/catalog/variants-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ApiError, describeError } from '@/lib/api/client';
import { useProduct, useSupplier, useUpdateProduct } from '@/lib/catalog-queries';
import { formatMoney } from '@/lib/money';

type TabId = 'overview' | 'variants' | 'images' | 'supplier' | 'activity';

function StatusActions({
  organizationId,
  product,
}: {
  organizationId: string;
  product: ProductDetail;
}) {
  const notify = useToast();
  const update = useUpdateProduct(organizationId, product.id);
  const [confirming, setConfirming] = useState<ProductStatus | null>(null);

  const apply = async (status: ProductStatus) => {
    try {
      await update.mutateAsync({ status });
      notify(`Product is now ${PRODUCT_STATUS_LABELS[status].label.toLowerCase()}`);
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="flex gap-2">
      {productStatusActions(product.status).map((action) => (
        <Button
          key={action.to}
          variant={action.destructive ? 'danger' : action.to === 'ACTIVE' ? 'primary' : 'secondary'}
          loading={update.isPending && update.variables?.status === action.to}
          onClick={() => (action.destructive ? setConfirming(action.to) : void apply(action.to))}
        >
          {action.label}
        </Button>
      ))}
      <ConfirmDialog
        open={confirming !== null}
        title={`Archive “${product.name}”?`}
        description="It can no longer be sold or edited. Orders that reference it keep their history. You can restore it later as inactive."
        confirmLabel="Archive product"
        pending={update.isPending}
        onConfirm={() => confirming && void apply(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

function SupplierTab({
  organizationId,
  product,
}: {
  organizationId: string;
  product: ProductDetail;
}) {
  const { can } = usePermissions();
  const allowed = can('suppliers.read');
  const supplier = useSupplier(
    organizationId,
    product.supplier?.id ?? '',
    Boolean(product.supplier) && allowed,
  );
  if (!product.supplier)
    return (
      <Panel title="Supplier">
        <EmptyState title="No supplier assigned" description="Choose one on the Overview tab." />
      </Panel>
    );
  if (!allowed)
    return (
      <Panel title="Supplier">
        <div className="p-5 text-sm">{product.supplier.companyName}</div>
      </Panel>
    );
  if (supplier.isPending) return <LoadingRows label="Loading supplier" />;
  if (supplier.isError) return <Alert tone="error">{describeError(supplier.error)}</Alert>;
  const s = supplier.data;
  return (
    <Panel
      title={s.companyName}
      actions={
        <Link
          href={`/suppliers/${s.id}`}
          className="text-sm font-medium text-accent hover:underline"
        >
          Open supplier
        </Link>
      }
    >
      <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
        {[
          [
            'Status',
            <Badge key="s" tone={PARTNER_STATUS_LABELS[s.status].tone}>
              {PARTNER_STATUS_LABELS[s.status].label}
            </Badge>,
          ],
          ['Contact', s.contactName ?? '—'],
          ['Email', s.email ?? '—'],
          ['Phone', s.phone ?? '—'],
          ['Lead time', `${s.leadTimeDays} days`],
          ['Payment terms', PAYMENT_TERMS_LABELS[s.paymentTerms]],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Lifecycle from the record itself. The full change history arrives with the audit service. */
function ActivityTab({ product }: { product: ProductDetail }) {
  const events = [
    { at: product.createdAt, text: 'Created' },
    ...(product.updatedAt !== product.createdAt
      ? [{ at: product.updatedAt, text: 'Last changed' }]
      : []),
    ...(product.archivedAt ? [{ at: product.archivedAt, text: 'Archived' }] : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Panel
      title="Activity"
      description="Key moments in this product's life. A detailed change history is recorded as catalog events."
    >
      <ol className="divide-y divide-line">
        {events.map((event) => (
          <li key={event.text} className="flex justify-between px-5 py-3 text-sm">
            <span>{event.text}</span>
            <time dateTime={event.at} className="text-ink-muted">
              {formatDateTime(event.at)}
            </time>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function ProductView({ organizationId, productId }: { organizationId: string; productId: string }) {
  const { can } = usePermissions();
  const notify = useToast();
  const product = useProduct(organizationId, productId);
  const [tab, setTab] = useState<TabId>('overview');

  if (product.isPending) return <LoadingRows rows={6} label="Loading product" />;
  if (product.isError) {
    // 400 is a malformed id in the URL: to the user that is the same as a missing product.
    return product.error instanceof ApiError &&
      (product.error.status === 404 || product.error.status === 400) ? (
      <EmptyState
        title="Product not found"
        description="It does not exist in this organization."
        action={
          <Link href="/products" className="text-sm font-medium text-accent hover:underline">
            Back to products
          </Link>
        }
      />
    ) : (
      <Alert tone="error">{describeError(product.error)}</Alert>
    );
  }

  const p = product.data;
  const archived = p.status === 'ARCHIVED';
  const canEdit = can('products.update') && !archived;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="mb-2 text-sm">
        <Link href="/products" className="text-ink-muted hover:text-ink">
          ← Products
        </Link>
      </p>
      <PageHeader
        title={p.name}
        description={[p.brand, p.primarySku, formatMoney(p.basePrice, p.currency)]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={PRODUCT_STATUS_LABELS[p.status].tone}>
              {PRODUCT_STATUS_LABELS[p.status].label}
            </Badge>
            {can('products.update') && (
              <StatusActions organizationId={organizationId} product={p} />
            )}
          </div>
        }
      />
      {archived && (
        <div className="mb-4">
          <Alert tone="warning" title="This product is archived">
            It is read-only. Restore it to make changes.
          </Alert>
        </div>
      )}
      <Tabs
        label="Product sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'variants', label: 'Variants', count: p.variantCount },
          { id: 'images', label: 'Images', count: p.imageCount },
          { id: 'supplier', label: 'Supplier' },
          { id: 'activity', label: 'Activity' },
        ]}
      >
        {tab === 'overview' && (
          <Panel>
            <div className="p-5">
              <ProductForm
                key={p.updatedAt}
                organizationId={organizationId}
                product={p}
                readOnly={!canEdit}
                onSaved={() => notify('Product saved')}
              />
            </div>
          </Panel>
        )}
        {tab === 'variants' && (
          <VariantsPanel organizationId={organizationId} product={p} canEdit={canEdit} />
        )}
        {tab === 'images' && (
          <ImagesPanel organizationId={organizationId} productId={p.id} canEdit={canEdit} />
        )}
        {tab === 'supplier' && <SupplierTab organizationId={organizationId} product={p} />}
        {tab === 'activity' && <ActivityTab product={p} />}
      </Tabs>
    </div>
  );
}

export default function ProductPage() {
  const { productId } = useParams<{ productId: string }>();
  return (
    <RequireOrganization permission="products.read">
      {(organization) => <ProductView organizationId={organization.id} productId={productId} />}
    </RequireOrganization>
  );
}
