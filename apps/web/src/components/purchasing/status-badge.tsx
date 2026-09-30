import type { PurchaseOrderStatus } from '@solmira/contracts';
import { Badge } from '@/components/ui/badge';
import { PURCHASE_ORDER_STATUS_LABELS } from './labels';

export function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { label, tone } = PURCHASE_ORDER_STATUS_LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
