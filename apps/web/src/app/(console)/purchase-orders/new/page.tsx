'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { RequireOrganization } from '@/components/auth/require-organization';
import { PurchaseOrderForm } from '@/components/purchasing/purchase-order-form';
import { LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useOrganization } from '@/lib/queries';

function NewPurchaseOrder({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const notify = useToast();
  const search = useSearchParams();
  const organization = useOrganization(organizationId);
  if (organization.isPending) return <LoadingRows label="Loading" />;

  return (
    <div className="mx-auto max-w-4xl">
      <p className="mb-2 text-sm">
        <Link href="/purchase-orders" className="text-ink-muted hover:text-ink">
          ← Purchase orders
        </Link>
      </p>
      <PageHeader
        title="New purchase order"
        description="Orders start as drafts. Submit a draft for approval; once approved, its stock can be received."
      />
      <Panel>
        <div className="p-5">
          <PurchaseOrderForm
            organizationId={organizationId}
            defaultCurrency={organization.data?.currency ?? 'USD'}
            initialSupplierId={search.get('supplierId') ?? undefined}
            onSaved={(order) => {
              notify(`${order.number} created as a draft`);
              router.push(`/purchase-orders/${order.id}`);
            }}
            onCancel={() => router.push('/purchase-orders')}
          />
        </div>
      </Panel>
    </div>
  );
}

export default function NewPurchaseOrderPage() {
  return (
    <RequireOrganization permission="purchase_orders.create">
      {(organization) => (
        // useSearchParams needs a Suspense boundary so the page can still be prerendered.
        <Suspense fallback={<LoadingRows label="Loading" />}>
          <NewPurchaseOrder organizationId={organization.id} />
        </Suspense>
      )}
    </RequireOrganization>
  );
}
