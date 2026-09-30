'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePermissions } from '@/components/auth/can';
import { RequireOrganization } from '@/components/auth/require-organization';
import { PARTNER_STATUS_LABELS } from '@/components/catalog/labels';
import { WarehouseForm } from '@/components/catalog/warehouse-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { ApiError, describeError } from '@/lib/api/client';
import { useUpdateWarehouse, useWarehouse } from '@/lib/catalog-queries';

function WarehouseView({
  organizationId,
  warehouseId,
}: {
  organizationId: string;
  warehouseId: string;
}) {
  const notify = useToast();
  const { can } = usePermissions();
  const warehouse = useWarehouse(organizationId, warehouseId);
  const update = useUpdateWarehouse(organizationId, warehouseId);

  if (warehouse.isPending) return <LoadingRows rows={5} label="Loading warehouse" />;
  if (warehouse.isError) {
    return warehouse.error instanceof ApiError &&
      (warehouse.error.status === 404 || warehouse.error.status === 400) ? (
      <EmptyState
        title="Warehouse not found"
        action={
          <Link href="/warehouses" className="text-sm font-medium text-accent hover:underline">
            Back to warehouses
          </Link>
        }
      />
    ) : (
      <Alert tone="error">{describeError(warehouse.error)}</Alert>
    );
  }
  const w = warehouse.data;
  const next = w.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  const toggle = async () => {
    try {
      await update.mutateAsync({ status: next });
      notify(next === 'ACTIVE' ? 'Warehouse reactivated' : 'Warehouse deactivated');
    } catch (error) {
      notify(describeError(error), 'error');
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="mb-2 text-sm">
          <Link href="/warehouses" className="text-ink-muted hover:text-ink">
            ← Warehouses
          </Link>
        </p>
        <PageHeader
          title={`${w.code} · ${w.name}`}
          description={w.manager ? `Managed by ${w.manager.fullName}` : 'No manager assigned'}
          actions={
            <div className="flex items-center gap-3">
              <Badge tone={PARTNER_STATUS_LABELS[w.status].tone}>
                {PARTNER_STATUS_LABELS[w.status].label}
              </Badge>
              {can('warehouses.update') && (
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
      <Panel
        title="Details"
        description="Where this warehouse is and who runs it. Its stock is listed under Inventory."
        actions={
          can('inventory.read') && (
            <Link
              href={`/inventory?warehouseId=${w.id}`}
              className="text-sm font-medium text-accent hover:underline"
            >
              View stock
            </Link>
          )
        }
      >
        <div className="p-5">
          <WarehouseForm
            key={w.updatedAt}
            organizationId={organizationId}
            warehouse={w}
            readOnly={!can('warehouses.update')}
            onSaved={() => notify('Warehouse saved')}
          />
        </div>
      </Panel>
    </div>
  );
}

export default function WarehousePage() {
  const { warehouseId } = useParams<{ warehouseId: string }>();
  return (
    <RequireOrganization permission="warehouses.read">
      {(organization) => (
        <WarehouseView organizationId={organization.id} warehouseId={warehouseId} />
      )}
    </RequireOrganization>
  );
}
