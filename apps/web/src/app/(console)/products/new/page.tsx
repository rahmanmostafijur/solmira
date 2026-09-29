'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RequireOrganization } from '@/components/auth/require-organization';
import { ProductForm } from '@/components/catalog/product-form';
import { LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useOrganization } from '@/lib/queries';

function NewProduct({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const notify = useToast();
  const organization = useOrganization(organizationId);
  if (organization.isPending) return <LoadingRows label="Loading" />;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 text-sm">
        <Link href="/products" className="text-ink-muted hover:text-ink">
          ← Products
        </Link>
      </p>
      <PageHeader
        title="New product"
        description="Products start as drafts. Add an active variant, then activate the product to sell it."
      />
      <Panel>
        <div className="p-5">
          <ProductForm
            organizationId={organizationId}
            defaultCurrency={organization.data?.currency ?? 'USD'}
            onSaved={(product) => {
              notify(`“${product.name}” created as a draft`);
              router.push(`/products/${product.id}`);
            }}
            onCancel={() => router.push('/products')}
          />
        </div>
      </Panel>
    </div>
  );
}

export default function NewProductPage() {
  return (
    <RequireOrganization permission="products.create">
      {(organization) => <NewProduct organizationId={organization.id} />}
    </RequireOrganization>
  );
}
