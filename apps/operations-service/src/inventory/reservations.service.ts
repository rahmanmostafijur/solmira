import { Inject, Injectable } from '@nestjs/common';
import type {
  FieldIssue,
  Page,
  ReservationLine,
  ReservationListQuery,
  ReserveStockRequest,
  StockReservation,
} from '@solmira/contracts';
import type { TenantAuthContext } from '@solmira/service-kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { contains, offsetOf, orNotFound, pageOf } from '../common/query.js';
import { Database, type OperationsTransaction } from '../database/database.module.js';
import { inventoryLevels, inventoryReservations } from '../database/schema.js';
import { recordEvent } from '../outbox/outbox.js';
import {
  assertStockableVariant,
  assertStockableWarehouse,
} from '../warehouses/stock-references.js';
import { InsufficientStockError, shortage } from './errors.js';
import { reservationCount, reservationRows, toReservation } from './inventory-views.js';
import { applyStockChange, byLevelId, currentLevel, findLevel } from './stock-ledger.js';

@Injectable()
export class ReservationsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  list(auth: TenantAuthContext, query: ReservationListQuery): Promise<Page<StockReservation>> {
    return this.database.forTenant(auth, async (tx) => {
      const where = and(
        eq(inventoryReservations.organizationId, auth.organizationId),
        query.status ? eq(inventoryReservations.status, query.status) : undefined,
        query.warehouseId ? eq(inventoryLevels.warehouseId, query.warehouseId) : undefined,
        query.variantId ? eq(inventoryLevels.variantId, query.variantId) : undefined,
        query.search ? contains(inventoryReservations.reference, query.search) : undefined,
      );
      const rows = await reservationRows(tx)
        .where(where)
        .orderBy(desc(inventoryReservations.createdAt), desc(inventoryReservations.id))
        .limit(query.pageSize)
        .offset(offsetOf(query));
      const [total] = await reservationCount(tx).where(where);
      return pageOf(rows.map(toReservation), Number(total?.n ?? 0), query);
    });
  }

  reserve(auth: TenantAuthContext, input: ReserveStockRequest): Promise<StockReservation[]> {
    return this.database.forTenant(auth, async (tx) => {
      const ids = await this.reserveLines(tx, auth, input.lines, input.reference, input.note);
      return this.load(tx, auth, ids);
    });
  }

  /**
   * All-or-nothing reservation of several lines inside the caller's transaction (order
   * confirmation reuses this in phase 6). Lines are applied in level-id order so concurrent
   * multi-line reservations always lock rows in the same sequence and cannot deadlock. Every
   * short line is reported, then the whole transaction rolls back.
   */
  async reserveLines(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    lines: readonly ReservationLine[],
    reference: string,
    note?: string | null,
  ): Promise<string[]> {
    const shortages: { index: number; issue: FieldIssue }[] = [];
    const resolved: { index: number; line: ReservationLine; levelId: string }[] = [];
    for (const [index, line] of lines.entries()) {
      await assertStockableWarehouse(tx, auth, line.warehouseId, `lines.${index}.warehouseId`);
      await assertStockableVariant(tx, auth, line.variantId, `lines.${index}.variantId`);
      const level = await findLevel(tx, auth, line.warehouseId, line.variantId);
      if (level) resolved.push({ index, line, levelId: level.id });
      else shortages.push({ index, issue: shortage(`lines.${index}.quantity`, 0) });
    }

    const reservations: { id: string; levelId: string; line: ReservationLine }[] = [];
    for (const { index, line, levelId } of resolved.sort(byLevelId)) {
      const id = uuidv7();
      const updated = await applyStockChange(tx, auth, {
        levelId,
        type: 'RESERVATION',
        onHandChange: 0,
        reservedChange: line.quantity,
        referenceType: 'RESERVATION',
        referenceId: id,
        note,
      });
      if (updated) {
        reservations.push({ id, levelId, line });
      } else {
        const level = await currentLevel(tx, auth, levelId);
        const left = level ? level.onHand - level.reserved : 0;
        shortages.push({ index, issue: shortage(`lines.${index}.quantity`, left) });
      }
    }
    if (shortages.length > 0)
      throw new InsufficientStockError(
        shortages.sort((a, b) => a.index - b.index).map((entry) => entry.issue),
      );

    await tx.insert(inventoryReservations).values(
      reservations.map(({ id, levelId, line }) => ({
        id,
        organizationId: auth.organizationId,
        inventoryLevelId: levelId,
        quantity: line.quantity,
        reference,
        note: note ?? null,
        createdBy: auth.userId,
      })),
    );
    await recordEvent(tx, auth, 'inventory.reserved', {
      reference,
      reservations: reservations.map(({ id, line }) => ({
        reservationId: id,
        warehouseId: line.warehouseId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    });
    return reservations.map((reservation) => reservation.id);
  }

  /** Returns the held units to available stock. Releasing twice is a no-op, not an error. */
  release(auth: TenantAuthContext, id: string): Promise<StockReservation> {
    return this.database.forTenant(auth, async (tx) => {
      const [reservation] = await tx
        .select()
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.organizationId, auth.organizationId),
            eq(inventoryReservations.id, id),
          ),
        )
        .for('update');
      const current = orNotFound(reservation, 'Reservation');
      if (current.status === 'RELEASED') return (await this.load(tx, auth, [id]))[0]!;

      const updated = await applyStockChange(tx, auth, {
        levelId: current.inventoryLevelId,
        type: 'RELEASE',
        onHandChange: 0,
        reservedChange: -current.quantity,
        referenceType: 'RESERVATION',
        referenceId: id,
      });
      // reserved >= every active reservation by construction; failing here means corruption.
      if (!updated) throw new Error(`Reserved stock is below reservation ${id}`);
      await tx
        .update(inventoryReservations)
        .set({ status: 'RELEASED', releasedAt: new Date(), releasedBy: auth.userId })
        .where(
          and(
            eq(inventoryReservations.organizationId, auth.organizationId),
            eq(inventoryReservations.id, id),
          ),
        );
      await recordEvent(tx, auth, 'inventory.released', {
        reservationId: id,
        warehouseId: updated.warehouseId,
        variantId: updated.variantId,
        quantity: current.quantity,
      });
      return (await this.load(tx, auth, [id]))[0]!;
    });
  }

  private async load(
    tx: OperationsTransaction,
    auth: TenantAuthContext,
    ids: readonly string[],
  ): Promise<StockReservation[]> {
    const rows = await reservationRows(tx).where(
      and(
        eq(inventoryReservations.organizationId, auth.organizationId),
        inArray(inventoryReservations.id, [...ids]),
      ),
    );
    const byId = new Map(rows.map((row) => [row.reservation.id, toReservation(row)]));
    return ids.map((id) => byId.get(id)!);
  }
}
