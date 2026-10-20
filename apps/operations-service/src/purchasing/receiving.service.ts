import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  isPurchaseOrderReceivable,
  statusAfterReceipt,
  type FieldIssue,
  type PurchaseReceipt,
  type PurchaseReceiptResult,
  type ReceivePurchaseOrderRequest,
} from '@solmira/contracts';
import {
  ConflictError,
  ValidationError,
  getRequestContext,
  type TenantAuthContext,
} from '@solmira/service-kit';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { orNotFound } from '@solmira/service-kit';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { violatedConstraint } from '@solmira/service-kit';
import {
  purchaseOrderItems,
  purchaseOrders,
  purchaseReceiptItems,
  purchaseReceipts,
  warehouses,
} from '../database/schema.js';
import { stockCeilingError } from '../inventory/errors.js';
import { applyStockChange, byLevelId, ensureLevel } from '../inventory/stock-ledger.js';
import { recordEvent } from '../outbox/outbox.js';
import { resolvePurchasableVariants } from '../products/purchasable-variants.js';
import { loadOrder, loadReceipts } from './purchase-order-views.js';

const IDEMPOTENCY_CONSTRAINT = 'purchase_receipts_org_idempotency_key';

/**
 * The request's identity for idempotency: order, lines (order-independent) and note. Two
 * requests with the same key and the same fingerprint are the same receipt.
 */
export function receiptFingerprint(
  purchaseOrderId: string,
  input: ReceivePurchaseOrderRequest,
): string {
  const lines = [...input.lines]
    .sort((a, b) => (a.purchaseOrderItemId < b.purchaseOrderItemId ? -1 : 1))
    .map((line) => [line.purchaseOrderItemId, line.quantity]);
  return createHash('sha256')
    .update(JSON.stringify({ purchaseOrderId, lines, note: input.note ?? null }))
    .digest('hex');
}

type Outcome = { receiptId: string; replayed: boolean };

@Injectable()
export class ReceivingService {
  constructor(@Inject(Database) private readonly database: Database) {}

  listReceipts(auth: TenantAuthContext, purchaseOrderId: string): Promise<PurchaseReceipt[]> {
    return this.database.forTenant(auth, async (tx) => {
      const [order] = await tx
        .select({ id: purchaseOrders.id })
        .from(purchaseOrders)
        .where(this.orderOf(auth, purchaseOrderId));
      orNotFound(order, 'Purchase order');
      return loadReceipts(tx, auth.organizationId, { purchaseOrderId });
    });
  }

  /**
   * Receives goods against an approved order. Everything the receipt changes (order lines, order
   * status, stock levels, the inventory ledger, the receipt record and the outbox events) is
   * written in one transaction: it all happens, or none of it does.
   *
   * Retry safety: the Idempotency-Key is stored on the receipt under a unique constraint. A retry
   * (same key, same request) returns the original receipt; the same key with a different request
   * is a conflict. Concurrent duplicates serialize on the order lock; the constraint covers the
   * rest.
   */
  async receive(
    auth: TenantAuthContext,
    purchaseOrderId: string,
    input: ReceivePurchaseOrderRequest,
    idempotencyKey: string,
  ): Promise<PurchaseReceiptResult> {
    const fingerprint = receiptFingerprint(purchaseOrderId, input);
    let outcome: Outcome;
    try {
      outcome = await this.database.forTenant(auth, (tx) =>
        this.receiveInTransaction(tx, auth, purchaseOrderId, input, idempotencyKey, fingerprint),
      );
    } catch (error) {
      // Lost a race with another request using the same key (possibly for another order).
      if (violatedConstraint(error, 'unique') !== IDEMPOTENCY_CONSTRAINT) throw error;
      outcome = await this.database.forTenant(auth, async (tx) => {
        const replay = await this.replay(tx, auth, idempotencyKey, fingerprint);
        if (!replay) throw error;
        return replay;
      });
    }
    return this.database.forTenant(auth, async (tx) => {
      const [receipt] = await loadReceipts(tx, auth.organizationId, {
        receiptIds: [outcome.receiptId],
      });
      return {
        receipt: receipt!,
        purchaseOrder: await loadOrder(tx, auth.organizationId, receipt!.purchaseOrderId),
        replayed: outcome.replayed,
      };
    });
  }

  private async receiveInTransaction(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    purchaseOrderId: string,
    input: ReceivePurchaseOrderRequest,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<Outcome> {
    // 1. Lock the order: receipts, edits and cancellation of one order now run one at a time.
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(this.orderOf(auth, purchaseOrderId))
      .for('update');
    const current = orNotFound(order, 'Purchase order');

    // 2. A retry of a receipt that already committed returns it unchanged.
    const replay = await this.replay(tx, auth, idempotencyKey, fingerprint);
    if (replay) return replay;

    if (!isPurchaseOrderReceivable(current.status))
      throw new ConflictError(
        `Only approved purchase orders can be received (this one is ${current.status.toLowerCase()})`,
      );
    // FOR SHARE: a concurrent deactivation waits for this receipt (or this receipt sees it).
    const [warehouse] = await tx
      .select({ status: warehouses.status })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.organizationId, auth.organizationId),
          eq(warehouses.id, current.warehouseId),
        ),
      )
      .for('share');
    if (warehouse?.status !== 'ACTIVE')
      throw new ConflictError('The receiving warehouse is inactive; reactivate it first');

    // 3. Validate every line against what is still outstanding (stable: the order is locked).
    const items = await tx
      .select()
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.organizationId, auth.organizationId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
          inArray(
            purchaseOrderItems.id,
            input.lines.map((line) => line.purchaseOrderItemId),
          ),
        ),
      );
    const byId = new Map(items.map((item) => [item.id, item]));
    const unknown: FieldIssue[] = [];
    const over: FieldIssue[] = [];
    input.lines.forEach((line, index) => {
      const item = byId.get(line.purchaseOrderItemId);
      if (!item) {
        unknown.push({
          path: `lines.${index}.purchaseOrderItemId`,
          message: 'Not a line of this purchase order',
        });
        return;
      }
      const remaining = item.orderedQuantity - item.receivedQuantity;
      if (line.quantity > remaining)
        over.push({
          path: `lines.${index}.quantity`,
          message: remaining > 0 ? `Only ${remaining} remaining` : 'Nothing remaining on this line',
        });
    });
    if (unknown.length > 0) throw new ValidationError(unknown);
    if (over.length > 0) throw new ConflictError('Cannot receive more than was ordered', over);

    const variants = await resolvePurchasableVariants(
      tx,
      auth,
      items.map((item) => item.variantId),
    );
    const inactive = input.lines.flatMap((line, index) => {
      const problem = variants.get(byId.get(line.purchaseOrderItemId)!.variantId)?.problem;
      return problem ? [{ path: `lines.${index}.purchaseOrderItemId`, message: problem }] : [];
    });
    if (inactive.length > 0)
      throw new ConflictError('Stock cannot be added for inactive variants', inactive);

    // 4. The receipt row first: a concurrent duplicate key fails here, before any stock moves.
    const receiptId = uuidv7();
    await tx.insert(purchaseReceipts).values({
      id: receiptId,
      organizationId: auth.organizationId,
      purchaseOrderId,
      warehouseId: current.warehouseId,
      receivedBy: auth.userId,
      note: input.note ?? null,
      idempotencyKey,
      requestHash: fingerprint,
      correlationId: getRequestContext()?.correlationId ?? uuidv7(),
    });

    // 5. Order lines: guarded, so received can never pass ordered even if the checks above were
    //    ever bypassed (the CHECK constraint is the last line of defence).
    for (const [index, line] of input.lines.entries()) {
      const [updated] = await tx
        .update(purchaseOrderItems)
        .set({
          receivedQuantity: sql`${purchaseOrderItems.receivedQuantity} + ${line.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(purchaseOrderItems.organizationId, auth.organizationId),
            eq(purchaseOrderItems.id, line.purchaseOrderItemId),
            sql`${purchaseOrderItems.receivedQuantity} + ${line.quantity} <= ${purchaseOrderItems.orderedQuantity}`,
          ),
        )
        .returning({ id: purchaseOrderItems.id });
      if (!updated)
        throw new ConflictError('Cannot receive more than was ordered', [
          { path: `lines.${index}.quantity`, message: 'More than remains on this line' },
        ]);
    }

    // 6. Stock and ledger through the one inventory write path. Missing levels are created in
    //    variant order and existing ones updated in level-id order: two receipts touching the
    //    same variants in opposite orders can never wait on each other.
    const moves = [];
    const byVariant = [...input.lines.entries()].sort(([, a], [, b]) => {
      const [x, y] = [
        byId.get(a.purchaseOrderItemId)!.variantId,
        byId.get(b.purchaseOrderItemId)!.variantId,
      ];
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const [index, line] of byVariant) {
      const item = byId.get(line.purchaseOrderItemId)!;
      const level = await ensureLevel(tx, auth, current.warehouseId, item.variantId);
      moves.push({ index, line, item, levelId: level.id, movementId: uuidv7() });
    }
    for (const move of moves.sort(byLevelId)) {
      const updated = await applyStockChange(tx, auth, {
        levelId: move.levelId,
        movementId: move.movementId,
        type: 'PURCHASE_RECEIPT',
        onHandChange: move.line.quantity,
        reservedChange: 0,
        referenceType: 'PURCHASE_RECEIPT',
        referenceId: receiptId,
        note: input.note ?? `Received against ${current.number}`,
      });
      if (!updated) throw stockCeilingError(`lines.${move.index}.quantity`);
    }
    await tx.insert(purchaseReceiptItems).values(
      moves.map((move) => ({
        id: uuidv7(),
        organizationId: auth.organizationId,
        receiptId,
        purchaseOrderId,
        purchaseOrderItemId: move.item.id,
        quantity: move.line.quantity,
        inventoryMovementId: move.movementId,
      })),
    );

    // 7. The order's status follows from the aggregate of all its lines.
    const totals = await tx
      .select({
        orderedQuantity: purchaseOrderItems.orderedQuantity,
        receivedQuantity: purchaseOrderItems.receivedQuantity,
      })
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.organizationId, auth.organizationId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        ),
      );
    const status = statusAfterReceipt(totals);
    const now = new Date();
    await tx
      .update(purchaseOrders)
      .set({ status, receivedAt: status === 'RECEIVED' ? now : null, updatedAt: now })
      .where(this.orderOf(auth, purchaseOrderId));

    // 8. Events for the relay (phase 7), in the same transaction.
    await recordEvent(tx, auth, 'inventory.received', {
      receiptId,
      purchaseOrderId,
      warehouseId: current.warehouseId,
      lines: moves.map((move) => ({
        variantId: move.item.variantId,
        quantity: move.line.quantity,
        inventoryLevelId: move.levelId,
      })),
    });
    await recordEvent(
      tx,
      auth,
      status === 'RECEIVED' ? 'purchase_order.received' : 'purchase_order.partially_received',
      { purchaseOrderId, number: current.number, receiptId },
    );
    return { receiptId, replayed: false };
  }

  private async replay(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<Outcome | null> {
    const [existing] = await tx
      .select({ id: purchaseReceipts.id, requestHash: purchaseReceipts.requestHash })
      .from(purchaseReceipts)
      .where(
        and(
          eq(purchaseReceipts.organizationId, auth.organizationId),
          eq(purchaseReceipts.idempotencyKey, idempotencyKey),
        ),
      );
    if (!existing) return null;
    if (existing.requestHash !== fingerprint)
      throw new ConflictError('This Idempotency-Key was already used for a different receipt', [
        { path: 'Idempotency-Key', message: 'Use a new key for a new receipt' },
      ]);
    return { receiptId: existing.id, replayed: true };
  }

  private orderOf(auth: TenantAuthContext, id: string) {
    return and(eq(purchaseOrders.organizationId, auth.organizationId), eq(purchaseOrders.id, id));
  }
}
