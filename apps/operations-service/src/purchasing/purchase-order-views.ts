import type {
  PurchaseOrderDetail,
  PurchaseOrderItem,
  PurchaseOrderSummary,
  PurchaseReceipt,
} from '@solmira/contracts';
import { and, asc, count, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { iso, orNotFound } from '@solmira/service-kit';
import type { OperationsTransaction } from '../database/database.module.js';
import {
  productVariants,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  suppliers,
  warehouses,
} from '../database/schema.js';

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;

/**
 * Supplier and warehouse are joined for display, never copied onto the order: both are
 * tenant-owned master data that is deactivated rather than deleted, so the live row is always
 * there. A name snapshot can be added if documents ever need "as ordered" names (ADR-0021).
 */
const supplierColumns = {
  id: suppliers.id,
  companyName: suppliers.companyName,
  status: suppliers.status,
};
const warehouseColumns = {
  id: warehouses.id,
  code: warehouses.code,
  name: warehouses.name,
  status: warehouses.status,
};

const onSupplier = and(
  eq(suppliers.organizationId, purchaseOrders.organizationId),
  eq(suppliers.id, purchaseOrders.supplierId),
);
const onWarehouse = and(
  eq(warehouses.organizationId, purchaseOrders.organizationId),
  eq(warehouses.id, purchaseOrders.warehouseId),
);

/** Line count in the same query as the list (index-backed correlated subquery, no N+1). */
const itemCount = sql<number>`(
  select count(*)::int from ${purchaseOrderItems}
   where ${purchaseOrderItems.organizationId} = ${purchaseOrders.organizationId}
     and ${purchaseOrderItems.purchaseOrderId} = ${purchaseOrders.id})`;

export const orderRows = (tx: OperationsTransaction) =>
  tx
    .select({
      order: purchaseOrders,
      supplier: supplierColumns,
      warehouse: warehouseColumns,
      itemCount,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, onSupplier)
    .innerJoin(warehouses, onWarehouse);

export const orderCount = (tx: OperationsTransaction) =>
  tx.select({ n: count() }).from(purchaseOrders).innerJoin(suppliers, onSupplier);

type OrderRowWithLabels = Awaited<ReturnType<ReturnType<typeof orderRows>['execute']>>[number];

export function toSummary(row: OrderRowWithLabels): PurchaseOrderSummary {
  const { order } = row;
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    supplier: row.supplier,
    warehouse: row.warehouse,
    currency: order.currency,
    itemCount: row.itemCount,
    total: order.totalMinor,
    expectedDeliveryDate: order.expectedDeliveryDate,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
  };
}

const optionalIso = (value: Date | null) => (value ? iso(value) : null);

export async function loadOrderItems(
  tx: OperationsTransaction,
  organizationId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderItem[]> {
  const rows = await tx
    .select({
      item: purchaseOrderItems,
      sku: productVariants.sku,
      variantName: productVariants.name,
      productName: products.name,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      productVariants,
      and(
        eq(productVariants.organizationId, purchaseOrderItems.organizationId),
        eq(productVariants.id, purchaseOrderItems.variantId),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.organizationId, purchaseOrderItems.organizationId),
        eq(products.id, purchaseOrderItems.productId),
      ),
    )
    .where(
      and(
        eq(purchaseOrderItems.organizationId, organizationId),
        eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
      ),
    )
    .orderBy(asc(purchaseOrderItems.createdAt), asc(purchaseOrderItems.id));
  return rows.map(({ item, sku, variantName, productName }) => ({
    id: item.id,
    productId: item.productId,
    productName,
    variantId: item.variantId,
    sku,
    variantName,
    orderedQuantity: item.orderedQuantity,
    receivedQuantity: item.receivedQuantity,
    remainingQuantity: item.orderedQuantity - item.receivedQuantity,
    unitCost: item.unitCostMinor,
    taxRateBps: item.taxRateBps,
    subtotal: item.subtotalMinor,
    tax: item.taxMinor,
    total: item.totalMinor,
  }));
}

export async function loadOrder(
  tx: OperationsTransaction,
  organizationId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderDetail> {
  const [row] = await orderRows(tx).where(
    and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.id, purchaseOrderId)),
  );
  const found = orNotFound(row, 'Purchase order');
  const items = await loadOrderItems(tx, organizationId, purchaseOrderId);
  const [receipts] = await tx
    .select({ n: count(), last: max(purchaseReceipts.receivedAt) })
    .from(purchaseReceipts)
    .where(
      and(
        eq(purchaseReceipts.organizationId, organizationId),
        eq(purchaseReceipts.purchaseOrderId, purchaseOrderId),
      ),
    );
  const orderedUnits = items.reduce((sum, item) => sum + item.orderedQuantity, 0);
  const receivedUnits = items.reduce((sum, item) => sum + item.receivedQuantity, 0);
  const { order } = found;
  return {
    ...toSummary(found),
    notes: order.notes,
    subtotal: order.subtotalMinor,
    tax: order.taxMinor,
    shippingCost: order.shippingMinor,
    createdBy: order.createdBy,
    submittedBy: order.submittedBy,
    submittedAt: optionalIso(order.submittedAt),
    approvedBy: order.approvedBy,
    approvedAt: optionalIso(order.approvedAt),
    receivedAt: optionalIso(order.receivedAt),
    cancelledBy: order.cancelledBy,
    cancelledAt: optionalIso(order.cancelledAt),
    cancellationReason: order.cancellationReason,
    items,
    receiving: {
      orderedUnits,
      receivedUnits,
      remainingUnits: orderedUnits - receivedUnits,
      receiptCount: Number(receipts?.n ?? 0),
      lastReceivedAt: receipts?.last ? iso(new Date(receipts.last)) : null,
    },
  };
}

/** Receipts with their lines: two queries for any number of receipts. */
export async function loadReceipts(
  tx: OperationsTransaction,
  organizationId: string,
  where: { purchaseOrderId: string } | { receiptIds: readonly string[] },
): Promise<PurchaseReceipt[]> {
  const receiptRows = await tx
    .select({ receipt: purchaseReceipts, warehouse: warehouseColumns })
    .from(purchaseReceipts)
    .innerJoin(
      warehouses,
      and(
        eq(warehouses.organizationId, purchaseReceipts.organizationId),
        eq(warehouses.id, purchaseReceipts.warehouseId),
      ),
    )
    .where(
      and(
        eq(purchaseReceipts.organizationId, organizationId),
        'purchaseOrderId' in where
          ? eq(purchaseReceipts.purchaseOrderId, where.purchaseOrderId)
          : inArray(purchaseReceipts.id, [...where.receiptIds]),
      ),
    )
    .orderBy(desc(purchaseReceipts.receivedAt), desc(purchaseReceipts.id));
  if (receiptRows.length === 0) return [];

  const lineRows = await tx
    .select({
      line: purchaseReceiptItems,
      variantId: purchaseOrderItems.variantId,
      sku: productVariants.sku,
      variantName: productVariants.name,
    })
    .from(purchaseReceiptItems)
    .innerJoin(
      purchaseOrderItems,
      and(
        eq(purchaseOrderItems.organizationId, purchaseReceiptItems.organizationId),
        eq(purchaseOrderItems.id, purchaseReceiptItems.purchaseOrderItemId),
      ),
    )
    .innerJoin(
      productVariants,
      and(
        eq(productVariants.organizationId, purchaseOrderItems.organizationId),
        eq(productVariants.id, purchaseOrderItems.variantId),
      ),
    )
    .where(
      and(
        eq(purchaseReceiptItems.organizationId, organizationId),
        inArray(
          purchaseReceiptItems.receiptId,
          receiptRows.map((row) => row.receipt.id),
        ),
      ),
    )
    .orderBy(asc(productVariants.sku));

  return receiptRows.map(({ receipt, warehouse }) => ({
    id: receipt.id,
    purchaseOrderId: receipt.purchaseOrderId,
    warehouse,
    receivedBy: receipt.receivedBy,
    receivedAt: iso(receipt.receivedAt),
    note: receipt.note,
    lines: lineRows
      .filter((row) => row.line.receiptId === receipt.id)
      .map(({ line, variantId, sku, variantName }) => ({
        id: line.id,
        purchaseOrderItemId: line.purchaseOrderItemId,
        variantId,
        sku,
        variantName,
        quantity: line.quantity,
        inventoryMovementId: line.inventoryMovementId,
      })),
  }));
}
