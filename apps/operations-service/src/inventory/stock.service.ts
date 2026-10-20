import { Inject, Injectable } from '@nestjs/common';
import type {
  AdjustStockRequest,
  InventoryLevel,
  StockTransferResult,
  TransferStockRequest,
} from '@solmira/contracts';
import type { TenantAuthContext } from '@solmira/service-kit';
import { v7 as uuidv7 } from 'uuid';
import { orNotFound } from '@solmira/service-kit';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { recordEvent } from '../outbox/outbox.js';
import {
  assertStockableVariant,
  assertStockableWarehouse,
  assertVariantExists,
  assertWarehouseExists,
} from '../warehouses/stock-references.js';
import { InsufficientStockError, shortage, stockCeilingError } from './errors.js';
import { loadLevel } from './inventory-views.js';
import {
  applyStockChange,
  byLevelId,
  ensureLevel,
  findLevel,
  type StockChange,
} from './stock-ledger.js';

const available = (level: { onHand: number; reserved: number } | undefined) =>
  level ? level.onHand - level.reserved : 0;

@Injectable()
export class StockService {
  constructor(@Inject(Database) private readonly database: Database) {}

  /**
   * A manual correction of on-hand stock. A count states what is on the shelf; the change is
   * computed while the level is locked, so a reservation landing at the same moment cannot be
   * overwritten. On hand never drops below what is reserved: reserved units are promised.
   */
  adjust(auth: TenantAuthContext, input: AdjustStockRequest): Promise<InventoryLevel> {
    return this.database.forTenant(auth, async (tx) => {
      const field = input.reason === 'COUNT' ? 'countedQuantity' : 'quantityChange';
      const mayAdd = input.reason === 'COUNT' || (input.quantityChange ?? 0) > 0;
      let level = await findLevel(tx, auth, input.warehouseId, input.variantId, { lock: true });
      if (!level) {
        if (!mayAdd) {
          await assertWarehouseExists(tx, auth, input.warehouseId, 'warehouseId');
          await assertVariantExists(tx, auth, input.variantId, 'variantId');
          throw new InsufficientStockError([shortage(field, 0)]);
        }
        await this.assertCanHoldStock(tx, auth, input.warehouseId, input.variantId);
        await ensureLevel(tx, auth, input.warehouseId, input.variantId);
        level = await findLevel(tx, auth, input.warehouseId, input.variantId, { lock: true });
      }
      const current = level!;
      const change =
        input.reason === 'COUNT' ? input.countedQuantity! - current.onHand : input.quantityChange!;
      // A count that matches the shelf changes nothing, so it writes nothing.
      if (change === 0) return this.view(tx, auth, current.id);
      if (change > 0) await this.assertCanHoldStock(tx, auth, input.warehouseId, input.variantId);

      const updated = await applyStockChange(tx, auth, {
        levelId: current.id,
        type: 'ADJUSTMENT',
        reason: input.reason,
        onHandChange: change,
        reservedChange: 0,
        note: input.note,
      });
      if (!updated) {
        if (change > 0) throw stockCeilingError(field);
        // A count below what is reserved: the promised units are missing, which needs a person.
        if (input.reason === 'COUNT')
          throw new InsufficientStockError([
            { path: field, message: `${current.reserved} units are reserved; release them first` },
          ]);
        throw new InsufficientStockError([shortage(field, available(current))]);
      }
      await recordEvent(tx, auth, 'inventory.adjusted', {
        inventoryLevelId: updated.id,
        warehouseId: updated.warehouseId,
        variantId: updated.variantId,
        reason: input.reason,
        quantityChange: change,
        onHandAfter: updated.onHand,
      });
      return this.view(tx, auth, updated.id);
    });
  }

  /**
   * Moves available stock between two warehouses in one transaction: both levels change or
   * neither does. Transfers are immediate; goods in transit are not modeled (ADR-0019).
   */
  transfer(auth: TenantAuthContext, input: TransferStockRequest): Promise<StockTransferResult> {
    return this.database.forTenant(auth, async (tx) => {
      const source = await findLevel(tx, auth, input.fromWarehouseId, input.variantId);
      if (!source) {
        await assertWarehouseExists(tx, auth, input.fromWarehouseId, 'fromWarehouseId');
        await assertVariantExists(tx, auth, input.variantId, 'variantId');
        throw new InsufficientStockError([shortage('quantity', 0)]);
      }
      // The destination gains stock, so it follows the rules for adding stock.
      await assertStockableWarehouse(tx, auth, input.toWarehouseId, 'toWarehouseId');
      await assertStockableVariant(tx, auth, input.variantId, 'variantId');
      const destination = await ensureLevel(tx, auth, input.toWarehouseId, input.variantId);

      const transferId = uuidv7();
      const leg = (levelId: string, type: 'TRANSFER_OUT' | 'TRANSFER_IN', units: number) =>
        ({
          levelId,
          type,
          onHandChange: units,
          reservedChange: 0,
          referenceType: 'TRANSFER',
          referenceId: transferId,
          note: input.note,
        }) satisfies StockChange;
      const legs = [
        leg(source.id, 'TRANSFER_OUT', -input.quantity),
        leg(destination.id, 'TRANSFER_IN', input.quantity),
      ];
      // Lock order by level id: opposite transfers (A to B and B to A) cannot deadlock.
      for (const move of legs.sort(byLevelId)) {
        if (!(await applyStockChange(tx, auth, move))) {
          if (move.type === 'TRANSFER_IN') throw stockCeilingError('quantity');
          const latest = await findLevel(tx, auth, input.fromWarehouseId, input.variantId);
          throw new InsufficientStockError([shortage('quantity', available(latest))]);
        }
      }
      await recordEvent(tx, auth, 'inventory.transferred', {
        transferId,
        variantId: input.variantId,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        quantity: input.quantity,
      });
      return {
        transferId,
        from: await this.view(tx, auth, source.id),
        to: await this.view(tx, auth, destination.id),
      };
    });
  }

  private async assertCanHoldStock(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    warehouseId: string,
    variantId: string,
  ): Promise<void> {
    await assertStockableWarehouse(tx, auth, warehouseId, 'warehouseId');
    await assertStockableVariant(tx, auth, variantId, 'variantId');
  }

  private async view(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    levelId: string,
  ): Promise<InventoryLevel> {
    return orNotFound(await loadLevel(tx, auth.organizationId, levelId), 'Inventory level');
  }
}
