'use client';

import type { PurchaseOrderDetail } from '@solmira/contracts';
import type { ReactNode } from 'react';
import { formatDateTime } from '@/components/catalog/labels';
import { Panel } from '@/components/ui/feedback';
import { usePersonName } from './use-person-name';

interface Step {
  readonly label: string;
  readonly value: ReactNode;
}

/** Who moved the order through its lifecycle, and when; the basis for separation of duties. */
export function ApprovalPanel({
  organizationId,
  order,
  ownOrder,
}: {
  organizationId: string;
  order: PurchaseOrderDetail;
  /** The viewer created or submitted it, so cannot approve it. */
  ownOrder: boolean;
}) {
  const personName = usePersonName(organizationId);
  const at = (who: string | null, when: string) => (
    <>
      {personName(who)}
      <span className="text-ink-muted">
        {' '}
        · <time dateTime={when}>{formatDateTime(when)}</time>
      </span>
    </>
  );

  const approval: ReactNode = order.approvedAt ? (
    at(order.approvedBy, order.approvedAt)
  ) : order.status === 'SUBMITTED' ? (
    <span className="text-warn">
      Awaiting approval
      {ownOrder && (
        <span className="block text-xs text-ink-muted">
          You created or submitted this order, so someone else has to approve it.
        </span>
      )}
    </span>
  ) : (
    <span className="text-ink-muted">—</span>
  );

  const steps: Step[] = [
    { label: 'Created', value: at(order.createdBy, order.createdAt) },
    {
      label: 'Submitted',
      value: order.submittedAt ? (
        at(order.submittedBy, order.submittedAt)
      ) : (
        <span className="text-ink-muted">Not yet</span>
      ),
    },
    { label: 'Approved', value: approval },
    ...(order.receivedAt
      ? [{ label: 'Fully received', value: formatDateTime(order.receivedAt) }]
      : []),
    ...(order.cancelledAt
      ? [
          {
            label: 'Cancelled',
            value: (
              <>
                {at(order.cancelledBy, order.cancelledAt)}
                {order.cancellationReason && (
                  <span className="block text-ink-muted">“{order.cancellationReason}”</span>
                )}
              </>
            ),
          },
        ]
      : []),
  ];

  return (
    <Panel title="Approval">
      <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
        {steps.map(({ label, value }) => (
          <div key={label}>
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
