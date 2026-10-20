import { Inject, Injectable } from '@nestjs/common';
import {
  MAX_LINE_AMOUNT_MINOR,
  MAX_ORDER_AMOUNT_MINOR,
  MAX_PURCHASE_ORDER_LINES,
  PURCHASE_ORDER_OPEN_FIELDS,
  PURCHASE_ORDER_STATUSES,
  canApproveOwnOrder,
  canTransitionPurchaseOrder,
  formatPurchaseOrderNumber,
  isPurchaseOrderEditable,
  isPurchaseOrderOpen,
  lineAmounts,
  type CancelPurchaseOrderRequest,
  type CreatePurchaseOrder,
  type FieldIssue,
  type Page,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type PurchaseOrderListQuery,
  type PurchaseOrderStatus,
  type PurchaseOrderSummary,
  type SupplierPurchasingSummary,
  type UpdatePurchaseOrderItemRequest,
  type UpdatePurchaseOrderRequest,
} from '@solmira/contracts';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, asc, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { contains, offsetOf, orNotFound, pageOf, rethrowConflict } from '@solmira/service-kit';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import {
  purchaseOrderCounters,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import { resolvePurchasableVariants } from '../products/purchasable-variants.js';
import { assertPurchasableSupplier } from '../suppliers/supplier-references.js';
import { assertStockableWarehouse } from '../warehouses/stock-references.js';
import {
  loadOrder,
  orderCount,
  orderRows,
  toSummary,
  type PurchaseOrderRow,
} from './purchase-order-views.js';

const LINE_CONFLICTS = {
  purchase_order_items_org_order_variant_key:
    'This variant is already on the order; change its quantity instead',
};

const SORT_COLUMNS = {
  createdAt: purchaseOrders.createdAt,
  number: purchaseOrders.number,
  expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
  total: purchaseOrders.totalMinor,
} as const;

/** A date-only upper bound includes that whole day. */
function before(value: string): { date: Date; inclusive: boolean } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: new Date(value), inclusive: true };
  const next = new Date(`${value}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { date: next, inclusive: false };
}

const ACTION_MESSAGES: Record<'submit' | 'approve' | 'cancel', string> = {
  submit: 'Only a draft purchase order can be submitted',
  approve: 'Only a submitted purchase order can be approved',
  cancel: 'A received or cancelled purchase order cannot be cancelled',
};

function assertTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
  action: keyof typeof ACTION_MESSAGES,
): void {
  if (!canTransitionPurchaseOrder(from, to))
    throw new ConflictError(`${ACTION_MESSAGES[action]} (it is ${from.toLowerCase()})`);
}

function assertDraft(order: PurchaseOrderRow): void {
  if (!isPurchaseOrderEditable(order.status))
    throw new ConflictError('Only draft purchase orders can change their lines');
}

@Injectable()
export class PurchaseOrdersService {
  constructor(@Inject(Database) private readonly database: Database) {}

  // ---- reads ------------------------------------------------------------------------------------

  list(
    auth: TenantAuthContext,
    query: PurchaseOrderListQuery,
  ): Promise<Page<PurchaseOrderSummary>> {
    return this.database.forTenant(auth, async (tx) => {
      const createdTo = query.createdTo ? before(query.createdTo) : undefined;
      const where = and(
        eq(purchaseOrders.organizationId, auth.organizationId),
        query.status ? eq(purchaseOrders.status, query.status) : undefined,
        query.supplierId ? eq(purchaseOrders.supplierId, query.supplierId) : undefined,
        query.warehouseId ? eq(purchaseOrders.warehouseId, query.warehouseId) : undefined,
        query.createdFrom ? gte(purchaseOrders.createdAt, new Date(query.createdFrom)) : undefined,
        createdTo
          ? (createdTo.inclusive ? lte : lt)(purchaseOrders.createdAt, createdTo.date)
          : undefined,
        query.search
          ? or(
              contains(purchaseOrders.number, query.search),
              contains(suppliers.companyName, query.search),
            )
          : undefined,
      );
      const sortColumn = SORT_COLUMNS[query.sort];
      const rows = await orderRows(tx)
        .where(where)
        .orderBy(
          query.direction === 'asc' ? asc(sortColumn) : desc(sortColumn),
          desc(purchaseOrders.id),
        )
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await orderCount(tx).where(where);
      return pageOf(rows.map(toSummary), Number(total?.n ?? 0), query);
    });
  }

  get(auth: TenantAuthContext, id: string): Promise<PurchaseOrderDetail> {
    return this.database.forTenant(auth, (tx) => loadOrder(tx, auth.organizationId, id));
  }

  /** Supplier performance foundation: aggregate queries only, currencies kept apart. */
  supplierSummary(auth: TenantAuthContext, supplierId: string): Promise<SupplierPurchasingSummary> {
    return this.database.forTenant(auth, async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(
          and(eq(suppliers.organizationId, auth.organizationId), eq(suppliers.id, supplierId)),
        );
      orNotFound(supplier, 'Supplier');
      const ofSupplier = and(
        eq(purchaseOrders.organizationId, auth.organizationId),
        eq(purchaseOrders.supplierId, supplierId),
      );
      const byStatus = await tx
        .select({ status: purchaseOrders.status, n: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(ofSupplier)
        .groupBy(purchaseOrders.status);
      const byCurrency = await tx
        .select({
          currency: purchaseOrders.currency,
          total: sql<string>`sum(${purchaseOrders.totalMinor})`,
        })
        .from(purchaseOrders)
        .where(and(ofSupplier, sql`${purchaseOrders.status} <> 'CANCELLED'`))
        .groupBy(purchaseOrders.currency)
        .orderBy(asc(purchaseOrders.currency));
      const [delivery] = await tx
        .select({
          withDate: sql<number>`count(*) filter (where ${purchaseOrders.expectedDeliveryDate} is not null)::int`,
          onTime: sql<number>`count(*) filter (where (${purchaseOrders.receivedAt} at time zone 'UTC')::date <= ${purchaseOrders.expectedDeliveryDate})::int`,
          leadDays: sql<
            string | null
          >`avg(extract(epoch from ${purchaseOrders.receivedAt} - ${purchaseOrders.approvedAt}) / 86400)`,
        })
        .from(purchaseOrders)
        .where(and(ofSupplier, eq(purchaseOrders.status, 'RECEIVED')));
      const ordersByStatus = Object.fromEntries(
        PURCHASE_ORDER_STATUSES.map((status) => [
          status,
          byStatus.find((row) => row.status === status)?.n ?? 0,
        ]),
      ) as Record<PurchaseOrderStatus, number>;
      return {
        supplierId,
        ordersByStatus,
        orderedValue: byCurrency.map((row) => ({
          currency: row.currency,
          total: Number(row.total),
        })),
        receivedOrders: ordersByStatus.RECEIVED,
        onTimeOrders: delivery?.onTime ?? 0,
        ordersWithExpectedDate: delivery?.withDate ?? 0,
        averageLeadTimeDays:
          delivery?.leadDays == null ? null : Math.round(Number(delivery.leadDays) * 10) / 10,
      };
    });
  }

  // ---- drafts -----------------------------------------------------------------------------------

  create(auth: TenantAuthContext, input: CreatePurchaseOrder): Promise<PurchaseOrderDetail> {
    return this.database.forTenant(auth, async (tx) => {
      await assertPurchasableSupplier(tx, auth, input.supplierId);
      await assertStockableWarehouse(tx, auth, input.warehouseId, 'warehouseId');
      const productIds = await this.resolveLines(tx, auth, input.items, 'items');

      const id = uuidv7();
      const number = await this.nextNumber(tx, auth);
      await tx.insert(purchaseOrders).values({
        id,
        organizationId: auth.organizationId,
        number,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        currency: input.currency,
        expectedDeliveryDate: input.expectedDeliveryDate ?? null,
        notes: input.notes ?? null,
        shippingMinor: input.shippingCost,
        totalMinor: input.shippingCost,
        createdBy: auth.userId,
      });
      for (const line of input.items)
        await this.insertLine(tx, auth, id, line, productIds.get(line.variantId)!);
      await this.recalculate(tx, auth, id);
      await recordEvent(tx, auth, 'purchase_order.created', {
        purchaseOrderId: id,
        number,
        supplierId: input.supplierId,
      });
      return loadOrder(tx, auth.organizationId, id);
    });
  }

  /**
   * Drafts may change anything. After submission only notes and the expected delivery date may
   * change (the supplier may move the date); what was ordered, from whom, where, at what price
   * is fixed. Closed orders change nothing.
   */
  update(
    auth: TenantAuthContext,
    id: string,
    input: UpdatePurchaseOrderRequest,
  ): Promise<PurchaseOrderDetail> {
    return this.database.forTenant(auth, async (tx) => {
      const order = await this.lock(tx, auth, id);
      const fields = Object.keys(input) as (keyof UpdatePurchaseOrderRequest)[];
      if (!isPurchaseOrderOpen(order.status))
        throw new ConflictError('A received or cancelled purchase order cannot be changed');
      if (!isPurchaseOrderEditable(order.status)) {
        const locked = fields.filter(
          (field) => !(PURCHASE_ORDER_OPEN_FIELDS as readonly string[]).includes(field),
        );
        if (locked.length > 0)
          throw new ConflictError(
            'This purchase order has been submitted; only notes and the expected delivery date can change',
            locked.map((path) => ({ path, message: 'Locked after submission' })),
          );
      }
      // Line costs are minor units of the order's currency; switching currency would silently
      // re-read them (100.00 USD is not 100.00 JPY). There is no conversion, so refuse instead.
      if (input.currency && input.currency !== order.currency) {
        const [line] = await tx
          .select({ id: purchaseOrderItems.id })
          .from(purchaseOrderItems)
          .where(
            and(
              eq(purchaseOrderItems.organizationId, auth.organizationId),
              eq(purchaseOrderItems.purchaseOrderId, id),
            ),
          )
          .limit(1);
        if (line)
          throw new ConflictError('The currency of an order with lines cannot change', [
            {
              path: 'currency',
              message: `Line costs are in ${order.currency}; remove the lines first`,
            },
          ]);
      }
      if (input.supplierId && input.supplierId !== order.supplierId)
        await assertPurchasableSupplier(tx, auth, input.supplierId);
      if (input.warehouseId && input.warehouseId !== order.warehouseId)
        await assertStockableWarehouse(tx, auth, input.warehouseId, 'warehouseId');

      const { shippingCost, ...rest } = input;
      await tx
        .update(purchaseOrders)
        .set({
          ...rest,
          // Shipping and total change in one statement: the CHECK ties them together.
          ...(shippingCost !== undefined
            ? {
                shippingMinor: shippingCost,
                totalMinor: sql`${purchaseOrders.subtotalMinor} + ${purchaseOrders.taxMinor} + ${shippingCost}`,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(this.orderOf(auth, id));
      if (shippingCost !== undefined) await this.recalculate(tx, auth, id);
      await recordEvent(tx, auth, 'purchase_order.updated', { purchaseOrderId: id, fields });
      return loadOrder(tx, auth.organizationId, id);
    });
  }

  addItem(
    auth: TenantAuthContext,
    id: string,
    line: PurchaseOrderLine,
  ): Promise<PurchaseOrderDetail> {
    return this.writeLines(auth, id, async (tx) => {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(purchaseOrderItems)
        .where(
          and(
            eq(purchaseOrderItems.organizationId, auth.organizationId),
            eq(purchaseOrderItems.purchaseOrderId, id),
          ),
        );
      if (n >= MAX_PURCHASE_ORDER_LINES)
        throw new ValidationError([
          { path: 'variantId', message: `An order has at most ${MAX_PURCHASE_ORDER_LINES} lines` },
        ]);
      const productIds = await this.resolveLines(tx, auth, [line], '');
      await this.insertLine(tx, auth, id, line, productIds.get(line.variantId)!);
      return ['items'];
    });
  }

  updateItem(
    auth: TenantAuthContext,
    id: string,
    itemId: string,
    change: UpdatePurchaseOrderItemRequest,
  ): Promise<PurchaseOrderDetail> {
    return this.writeLines(auth, id, async (tx) => {
      const [item] = await tx
        .select()
        .from(purchaseOrderItems)
        .where(this.itemOf(auth, id, itemId));
      const current = orNotFound(item, 'Purchase order line');
      const quantity = change.quantity ?? current.orderedQuantity;
      const unitCost = change.unitCost ?? current.unitCostMinor;
      const taxRateBps = change.taxRateBps ?? current.taxRateBps;
      // The merged line must respect the same cap as a new one (each field alone may be valid).
      if (lineAmounts(quantity, unitCost, taxRateBps).total > MAX_LINE_AMOUNT_MINOR)
        throw new ValidationError([{ path: 'unitCost', message: 'This line is too large' }]);
      await tx
        .update(purchaseOrderItems)
        .set({
          orderedQuantity: quantity,
          unitCostMinor: unitCost,
          taxRateBps,
          ...this.amounts(quantity, unitCost, taxRateBps),
          updatedAt: new Date(),
        })
        .where(this.itemOf(auth, id, itemId));
      return ['items'];
    });
  }

  removeItem(auth: TenantAuthContext, id: string, itemId: string): Promise<PurchaseOrderDetail> {
    return this.writeLines(auth, id, async (tx) => {
      const removed = await tx
        .delete(purchaseOrderItems)
        .where(this.itemOf(auth, id, itemId))
        .returning({ id: purchaseOrderItems.id });
      orNotFound(removed[0], 'Purchase order line');
      return ['items'];
    });
  }

  // ---- workflow ---------------------------------------------------------------------------------

  /** DRAFT → SUBMITTED, after re-validating everything the order depends on. */
  submit(auth: TenantAuthContext, id: string): Promise<PurchaseOrderDetail> {
    return this.database.forTenant(auth, async (tx) => {
      const order = await this.lock(tx, auth, id);
      assertTransition(order.status, 'SUBMITTED', 'submit');
      const issues: FieldIssue[] = [];
      const items = await tx
        .select({ variantId: purchaseOrderItems.variantId })
        .from(purchaseOrderItems)
        .where(
          and(
            eq(purchaseOrderItems.organizationId, auth.organizationId),
            eq(purchaseOrderItems.purchaseOrderId, id),
          ),
        )
        .orderBy(asc(purchaseOrderItems.createdAt), asc(purchaseOrderItems.id));
      if (items.length === 0) issues.push({ path: 'items', message: 'Add at least one line' });
      await this.collect(issues, () => assertPurchasableSupplier(tx, auth, order.supplierId));
      await this.collect(issues, () =>
        assertStockableWarehouse(tx, auth, order.warehouseId, 'warehouseId'),
      );
      const variants = await resolvePurchasableVariants(
        tx,
        auth,
        items.map((item) => item.variantId),
      );
      items.forEach((item, index) => {
        const problem = variants.get(item.variantId)?.problem;
        if (problem) issues.push({ path: `items.${index}.variantId`, message: problem });
      });
      if (issues.length > 0) throw new ValidationError(issues, 'The order cannot be submitted');
      const totals = await this.recalculate(tx, auth, id);

      const now = new Date();
      await tx
        .update(purchaseOrders)
        .set({ status: 'SUBMITTED', submittedBy: auth.userId, submittedAt: now, updatedAt: now })
        .where(this.orderOf(auth, id));
      await recordEvent(tx, auth, 'purchase_order.submitted', {
        purchaseOrderId: id,
        number: order.number,
        total: totals.total,
        currency: order.currency,
      });
      return loadOrder(tx, auth.organizationId, id);
    });
  }

  /** SUBMITTED → APPROVED, by someone other than the person who created or submitted it. */
  approve(auth: TenantAuthContext, id: string): Promise<PurchaseOrderDetail> {
    return this.database.forTenant(auth, async (tx) => {
      const order = await this.lock(tx, auth, id);
      assertTransition(order.status, 'APPROVED', 'approve');
      if (!canApproveOwnOrder(auth.userId, order))
        throw new ForbiddenError(
          'A purchase order must be approved by someone other than the person who created or submitted it',
        );
      await assertPurchasableSupplier(tx, auth, order.supplierId);
      await assertStockableWarehouse(tx, auth, order.warehouseId, 'warehouseId');
      const now = new Date();
      await tx
        .update(purchaseOrders)
        .set({ status: 'APPROVED', approvedBy: auth.userId, approvedAt: now, updatedAt: now })
        .where(this.orderOf(auth, id));
      await recordEvent(tx, auth, 'purchase_order.approved', {
        purchaseOrderId: id,
        number: order.number,
        approvedBy: auth.userId,
      });
      return loadOrder(tx, auth.organizationId, id);
    });
  }

  /**
   * Cancels an open order. On a partially received order this closes the outstanding quantity:
   * what was received stays in stock and in the receipt history.
   */
  cancel(
    auth: TenantAuthContext,
    id: string,
    input: CancelPurchaseOrderRequest,
  ): Promise<PurchaseOrderDetail> {
    return this.database.forTenant(auth, async (tx) => {
      const order = await this.lock(tx, auth, id);
      assertTransition(order.status, 'CANCELLED', 'cancel');
      const now = new Date();
      await tx
        .update(purchaseOrders)
        .set({
          status: 'CANCELLED',
          cancelledBy: auth.userId,
          cancelledAt: now,
          cancellationReason: input.reason,
          updatedAt: now,
        })
        .where(this.orderOf(auth, id));
      await recordEvent(tx, auth, 'purchase_order.cancelled', {
        purchaseOrderId: id,
        number: order.number,
        fromStatus: order.status,
        reason: input.reason,
      });
      return loadOrder(tx, auth.organizationId, id);
    });
  }

  // ---- helpers ----------------------------------------------------------------------------------

  /**
   * Every write locks the order row first, so concurrent edits, submissions, approvals and
   * receipts of one order run one after another and each sees the others' committed result.
   */
  private async lock(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<PurchaseOrderRow> {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(this.orderOf(auth, id))
      .for('update');
    return orNotFound(order, 'Purchase order');
  }

  private async writeLines(
    auth: TenantAuthContext,
    id: string,
    work: (tx: OperationsTransaction) => Promise<string[]>,
  ): Promise<PurchaseOrderDetail> {
    try {
      return await this.database.forTenant(auth, async (tx) => {
        assertDraft(await this.lock(tx, auth, id));
        const fields = await work(tx);
        await this.recalculate(tx, auth, id);
        await tx
          .update(purchaseOrders)
          .set({ updatedAt: new Date() })
          .where(this.orderOf(auth, id));
        await recordEvent(tx, auth, 'purchase_order.updated', { purchaseOrderId: id, fields });
        return loadOrder(tx, auth.organizationId, id);
      });
    } catch (error) {
      rethrowConflict(error, LINE_CONFLICTS);
    }
  }

  /** Validates lines against the catalog in one query; returns each variant's product id. */
  private async resolveLines(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    lines: readonly PurchaseOrderLine[],
    prefix: string,
  ): Promise<Map<string, string>> {
    const variants = await resolvePurchasableVariants(
      tx,
      auth,
      lines.map((line) => line.variantId),
    );
    const issues = lines.flatMap((line, index) => {
      const problem = variants.get(line.variantId)?.problem;
      const path = prefix ? `${prefix}.${index}.variantId` : 'variantId';
      return problem ? [{ path, message: problem }] : [];
    });
    if (issues.length > 0) throw new ValidationError(issues);
    return new Map([...variants.values()].map((variant) => [variant.variantId, variant.productId]));
  }

  private amounts(quantity: number, unitCost: number, taxRateBps: number) {
    const { subtotal, tax, total } = lineAmounts(quantity, unitCost, taxRateBps);
    return { subtotalMinor: subtotal, taxMinor: tax, totalMinor: total };
  }

  private async insertLine(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    purchaseOrderId: string,
    line: PurchaseOrderLine,
    productId: string,
  ): Promise<void> {
    await tx.insert(purchaseOrderItems).values({
      id: uuidv7(),
      organizationId: auth.organizationId,
      purchaseOrderId,
      productId,
      variantId: line.variantId,
      orderedQuantity: line.quantity,
      unitCostMinor: line.unitCost,
      taxRateBps: line.taxRateBps,
      ...this.amounts(line.quantity, line.unitCost, line.taxRateBps),
    });
  }

  /**
   * Totals are always derived on the server from the stored lines (each computed exactly with
   * lineAmounts) plus shipping, in one statement. A client never supplies a total.
   */
  private async recalculate(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    id: string,
  ): Promise<{ total: number }> {
    const lines = and(
      eq(purchaseOrderItems.organizationId, auth.organizationId),
      eq(purchaseOrderItems.purchaseOrderId, id),
    );
    const [row] = await tx
      .update(purchaseOrders)
      .set({
        subtotalMinor: sql`(select coalesce(sum(${purchaseOrderItems.subtotalMinor}), 0) from ${purchaseOrderItems} where ${lines})`,
        taxMinor: sql`(select coalesce(sum(${purchaseOrderItems.taxMinor}), 0) from ${purchaseOrderItems} where ${lines})`,
        totalMinor: sql`(select coalesce(sum(${purchaseOrderItems.totalMinor}), 0) from ${purchaseOrderItems} where ${lines}) + ${purchaseOrders.shippingMinor}`,
      })
      .where(this.orderOf(auth, id))
      .returning({ total: purchaseOrders.totalMinor });
    if (row!.total > MAX_ORDER_AMOUNT_MINOR)
      throw new ValidationError([{ path: 'items', message: 'The order total is too large' }]);
    return row!;
  }

  /** PO-2026-000042: the counter row is locked by the upsert until this transaction ends. */
  private async nextNumber(tx: OperationsTransaction, auth: TenantAuthContext): Promise<string> {
    const year = new Date().getUTCFullYear();
    const [row] = await tx
      .insert(purchaseOrderCounters)
      .values({ organizationId: auth.organizationId, year, lastValue: 1 })
      .onConflictDoUpdate({
        target: [purchaseOrderCounters.organizationId, purchaseOrderCounters.year],
        set: { lastValue: sql`${purchaseOrderCounters.lastValue} + 1` },
      })
      .returning({ value: purchaseOrderCounters.lastValue });
    return formatPurchaseOrderNumber(year, row!.value);
  }

  private async collect(issues: FieldIssue[], check: () => Promise<void>): Promise<void> {
    try {
      await check();
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      issues.push(...(error.details ?? []));
    }
  }

  private orderOf(auth: TenantAuthContext, id: string) {
    return and(eq(purchaseOrders.organizationId, auth.organizationId), eq(purchaseOrders.id, id));
  }

  private itemOf(auth: TenantAuthContext, id: string, itemId: string) {
    return and(
      eq(purchaseOrderItems.organizationId, auth.organizationId),
      eq(purchaseOrderItems.purchaseOrderId, id),
      eq(purchaseOrderItems.id, itemId),
    );
  }
}
