'use client';

import type { PurchaseOrderDetail, PurchaseOrderItem } from '@solmira/contracts';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, Panel } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { describeError } from '@/lib/api/client';
import { formatMoney } from '@/lib/money';
import { useRemovePurchaseOrderItem } from '@/lib/purchasing-queries';
import { formatTaxRate, formatUnits } from './labels';
import { LineDialog } from './line-dialog';
import { OrderTotalsSummary } from './order-totals';

const TH = 'px-4 py-2.5 font-medium whitespace-nowrap';

/** The lines of an order with what has arrived; a draft's lines can be added, edited, removed. */
export function OrderLines({
  organizationId,
  order,
  editable,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  /** A draft the viewer may update. */
  editable: boolean;
}) {
  const notify = useToast();
  const remove = useRemovePurchaseOrderItem(organizationId, order.id);
  const [editing, setEditing] = useState<{ item: PurchaseOrderItem | null } | null>(null);
  const [removing, setRemoving] = useState<PurchaseOrderItem | null>(null);
  const money = (minor: number) => formatMoney(minor, order.currency);
  const showReceipt = order.status !== 'DRAFT';

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.id);
      notify(`${removing.sku} removed`);
    } catch (error) {
      notify(describeError(error), 'error');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Panel
      title="Items"
      description={`${order.items.length} line${order.items.length === 1 ? '' : 's'} · amounts in ${order.currency}`}
      actions={
        editable && (
          <Button size="sm" variant="secondary" onClick={() => setEditing({ item: null })}>
            <Plus aria-hidden className="size-4" /> Add line
          </Button>
        )
      }
    >
      {order.items.length === 0 ? (
        <EmptyState
          title="No lines yet"
          description={
            editable
              ? 'Add at least one line before submitting the order.'
              : 'This order has no lines.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Order lines" className="w-full text-sm">
            <thead className="bg-canvas text-xs text-ink-muted">
              <tr>
                <th scope="col" className={`${TH} text-left`}>
                  Item
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Ordered
                </th>
                {showReceipt && (
                  <>
                    <th scope="col" className={`${TH} text-right`}>
                      Received
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Remaining
                    </th>
                  </>
                )}
                <th scope="col" className={`${TH} text-right`}>
                  Unit cost
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Tax
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  Line total
                </th>
                {editable && (
                  <th scope="col" className={`${TH} text-right`}>
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.items.map((item) => (
                <tr key={item.id} className="hover:bg-canvas/60">
                  <td className="px-4 py-2.5">
                    <div className="min-w-40">
                      <span className="font-mono text-xs font-medium">{item.sku}</span>
                      <p>
                        <Link
                          href={`/products/${item.productId}`}
                          className="text-ink hover:text-accent hover:underline"
                        >
                          {item.productName}
                        </Link>
                        {item.variantName !== item.productName && (
                          <span className="text-ink-muted"> · {item.variantName}</span>
                        )}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatUnits(item.orderedQuantity)}
                  </td>
                  {showReceipt && (
                    <>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatUnits(item.receivedQuantity)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-medium tabular-nums ${item.remainingQuantity === 0 ? 'text-ok' : ''}`}
                      >
                        {formatUnits(item.remainingQuantity)}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {money(item.unitCost)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    {formatTaxRate(item.taxRateBps)}
                    {item.tax > 0 && (
                      <span className="block text-xs text-ink-muted">{money(item.tax)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap tabular-nums">
                    {money(item.total)}
                  </td>
                  {editable && (
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Edit ${item.sku}`}
                          title={`Edit ${item.sku}`}
                          onClick={() => setEditing({ item })}
                        >
                          <Pencil aria-hidden className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${item.sku}`}
                          title={`Remove ${item.sku}`}
                          onClick={() => setRemoving(item)}
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line p-5">
        <OrderTotalsSummary
          totals={{
            subtotal: order.subtotal,
            tax: order.tax,
            shippingCost: order.shippingCost,
            total: order.total,
          }}
          currency={order.currency}
        />
      </div>
      <LineDialog
        organizationId={organizationId}
        order={order}
        item={editing?.item ?? null}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.sku ?? 'line'}?`}
        description="The line leaves this draft and the totals are recalculated."
        confirmLabel="Remove line"
        pending={remove.isPending}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </Panel>
  );
}
