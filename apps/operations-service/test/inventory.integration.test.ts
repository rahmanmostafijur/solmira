import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Inventory against real PostgreSQL: the counters, the ledger they can be rebuilt from, the
 * rules for adding and taking stock, and what happens when many requests race for the same units.
 */
describe('inventory API (real PostgreSQL)', () => {
  let t: TestApp;
  let manager: Actor;
  const org = newOrganizationId();
  let seq = 0;

  const post = (path: string, body: object, as: Actor = manager) =>
    t.http().post(`/api/v1${path}`).set(as.auth).send(body);
  const get = (path: string, as: Actor = manager) => t.http().get(`/api/v1${path}`).set(as.auth);

  async function warehouse(status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): Promise<string> {
    seq += 1;
    const id = (
      await post('/warehouses', { code: `WH-${seq}`, name: `Warehouse ${seq}` }).expect(201)
    ).body.id;
    if (status === 'INACTIVE')
      await t.http().delete(`/api/v1/warehouses/${id}`).set(manager.auth).expect(204);
    return id;
  }

  async function variant(): Promise<{ id: string; productId: string }> {
    seq += 1;
    const product = (
      await post('/products', {
        name: `Stocked Product ${seq}`,
        basePrice: 1500,
        currency: 'USD',
        initialVariant: { sku: `STK-${seq}` },
      }).expect(201)
    ).body;
    const id = (await get(`/products/${product.id}/variants`).expect(200)).body.items[0].id;
    return { id, productId: product.id };
  }
  const variantId = async () => (await variant()).id;

  const receive = (warehouseId: string, variantId: string, quantityChange: number) =>
    post('/inventory/adjustments', { warehouseId, variantId, reason: 'RECEIVED', quantityChange });

  const level = async (warehouseId: string, variantId: string) =>
    (await get(`/inventory/levels?warehouseId=${warehouseId}&variantId=${variantId}`).expect(200))
      .body.items[0];

  beforeAll(async () => {
    t = await createTestApp();
    // supertest binds the server once per in-flight request; the concurrency tests run 30 at once.
    t.app.getHttpServer().setMaxListeners(64);
    manager = await t.actor(org, 'MANAGER');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('adjustments', () => {
    it('receiving creates the level and a ledger row with the balance after it', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      const body = (await receive(w, v, 10).expect(201)).body;
      expect(body).toMatchObject({ onHand: 10, reserved: 0, available: 10, isLowStock: false });
      expect(body.warehouse.id).toBe(w);
      expect(body.item.variantId).toBe(v);

      const movements = (await get(`/inventory/movements?variantId=${v}`).expect(200)).body;
      expect(movements.items).toHaveLength(1);
      expect(movements.items[0]).toMatchObject({
        type: 'ADJUSTMENT',
        reason: 'RECEIVED',
        onHandChange: 10,
        reservedChange: 0,
        onHandAfter: 10,
        actorId: manager.userId,
      });
    });

    it('a count sets the shelf quantity; a count that matches writes nothing', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      await receive(w, v, 10).expect(201);
      const count = { warehouseId: w, variantId: v, reason: 'COUNT', countedQuantity: 7 };
      expect((await post('/inventory/adjustments', count).expect(201)).body.onHand).toBe(7);
      await post('/inventory/adjustments', count).expect(201);

      const movements = (await get(`/inventory/movements?variantId=${v}`).expect(200)).body.items;
      expect(movements.map((m: { onHandChange: number }) => m.onHandChange)).toEqual([-3, 10]);
    });

    it('rejects adjustments whose direction contradicts the reason', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      const received = await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'RECEIVED',
        quantityChange: -2,
      }).expect(400);
      expect(received.body.error.details[0].path).toBe('quantityChange');
      const count = await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'COUNT',
      }).expect(400);
      expect(count.body.error.details[0].path).toBe('countedQuantity');
    });

    it('never lets on hand fall below what is reserved', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      await receive(w, v, 10).expect(201);
      await post('/inventory/reservations', {
        lines: [{ warehouseId: w, variantId: v, quantity: 6 }],
        reference: 'Held for a customer',
      }).expect(201);

      const damaged = await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'DAMAGED',
        quantityChange: -5,
      }).expect(409);
      expect(damaged.body.error).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: [{ path: 'quantityChange', message: 'Only 4 available' }],
      });
      const lowCount = await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'COUNT',
        countedQuantity: 3,
      }).expect(409);
      expect(lowCount.body.error.details).toEqual([
        { path: 'countedQuantity', message: '6 units are reserved; release them first' },
      ]);
      await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'DAMAGED',
        quantityChange: -4,
      }).expect(201);
      expect(await level(w, v)).toMatchObject({ onHand: 6, reserved: 6, available: 0 });
    });

    it('removing stock that was never there is a conflict, not a new negative level', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      const response = await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'LOST',
        quantityChange: -1,
      }).expect(409);
      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(await level(w, v)).toBeUndefined();
    });

    it('stock can only be added to an active warehouse and an active variant', async () => {
      const inactive = await warehouse('INACTIVE');
      const response = await receive(inactive, await variantId(), 5).expect(400);
      expect(response.body.error.details[0]).toEqual({
        path: 'warehouseId',
        message: 'Warehouse is inactive',
      });

      const w = await warehouse();
      const retired = await variant();
      await t
        .http()
        .patch(`/api/v1/products/${retired.productId}/variants/${retired.id}`)
        .set(manager.auth)
        .send({ status: 'INACTIVE' })
        .expect(200);
      const inactiveVariant = await receive(w, retired.id, 5).expect(400);
      expect(inactiveVariant.body.error.details[0]).toEqual({
        path: 'variantId',
        message: 'Variant is not active',
      });
    });

    it('refuses an increase past the stock ceiling instead of overflowing the counter', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      const created = (await receive(w, v, 1).expect(201)).body;
      // Seed a balance near the ceiling directly (receiving a million at a time would take ages),
      // with its ledger row, so the reconciliation checks below still hold.
      await t.db.query(`update inventory_levels set on_hand = 999999999 where id = $1`, [
        created.id,
      ]);
      await t.db.query(
        `insert into inventory_movements (id, organization_id, inventory_level_id, type, reason,
           on_hand_change, reserved_change, on_hand_after, reserved_after, correlation_id)
         values (gen_random_uuid(), $1, $2, 'ADJUSTMENT', 'CORRECTION', 999999998, 0, 999999999, 0, 'seed')`,
        [org, created.id],
      );
      const response = await receive(w, v, 5).expect(400);
      expect(response.body.error.details[0]).toEqual({
        path: 'quantityChange',
        message: 'Stock cannot exceed 1,000,000,000 units',
      });
      await receive(w, v, 1).expect(201);
    });

    it('stock can still be taken out of a warehouse after it is deactivated', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      await receive(w, v, 3).expect(201);
      await t.http().delete(`/api/v1/warehouses/${w}`).set(manager.auth).expect(204);
      await post('/inventory/adjustments', {
        warehouseId: w,
        variantId: v,
        reason: 'CORRECTION',
        quantityChange: -3,
      }).expect(201);
    });
  });

  describe('transfers', () => {
    it('moves stock atomically, with two ledger rows sharing one transfer id', async () => {
      const [a, b, v] = [await warehouse(), await warehouse(), await variantId()];
      await receive(a, v, 10).expect(201);
      const result = (
        await post('/inventory/transfers', {
          fromWarehouseId: a,
          toWarehouseId: b,
          variantId: v,
          quantity: 4,
        }).expect(201)
      ).body;
      expect(result.from).toMatchObject({ onHand: 6 });
      expect(result.to).toMatchObject({ onHand: 4 });

      const movements = (await get(`/inventory/movements?variantId=${v}`).expect(200)).body.items;
      const legs = movements.filter(
        (m: { referenceType: string }) => m.referenceType === 'TRANSFER',
      );
      expect(legs.map((m: { type: string }) => m.type).sort()).toEqual([
        'TRANSFER_IN',
        'TRANSFER_OUT',
      ]);
      expect(new Set(legs.map((m: { referenceId: string }) => m.referenceId))).toEqual(
        new Set([result.transferId]),
      );
    });

    it('cannot move reserved or missing stock, and changes nothing when it fails', async () => {
      const [a, b, v] = [await warehouse(), await warehouse(), await variantId()];
      await receive(a, v, 5).expect(201);
      await post('/inventory/reservations', {
        lines: [{ warehouseId: a, variantId: v, quantity: 3 }],
        reference: 'Held',
      }).expect(201);
      const response = await post('/inventory/transfers', {
        fromWarehouseId: a,
        toWarehouseId: b,
        variantId: v,
        quantity: 3,
      }).expect(409);
      expect(response.body.error.details).toEqual([
        { path: 'quantity', message: 'Only 2 available' },
      ]);
      expect(await level(a, v)).toMatchObject({ onHand: 5, reserved: 3 });
      // The destination level created inside the failed transaction was rolled back with it.
      expect(await level(b, v)).toBeUndefined();
    });

    it('a retired variant cannot be moved into a new warehouse, only written off', async () => {
      const [a, b] = [await warehouse(), await warehouse()];
      const retired = await variant();
      await receive(a, retired.id, 5).expect(201);
      await t
        .http()
        .patch(`/api/v1/products/${retired.productId}/variants/${retired.id}`)
        .set(manager.auth)
        .send({ status: 'INACTIVE' })
        .expect(200);
      const response = await post('/inventory/transfers', {
        fromWarehouseId: a,
        toWarehouseId: b,
        variantId: retired.id,
        quantity: 1,
      }).expect(400);
      expect(response.body.error.details[0].path).toBe('variantId');
      await post('/inventory/adjustments', {
        warehouseId: a,
        variantId: retired.id,
        reason: 'CORRECTION',
        quantityChange: -5,
      }).expect(201);
    });

    it('rejects an inactive destination and a transfer to the same warehouse', async () => {
      const [a, inactive, v] = [await warehouse(), await warehouse('INACTIVE'), await variantId()];
      await receive(a, v, 5).expect(201);
      const toInactive = await post('/inventory/transfers', {
        fromWarehouseId: a,
        toWarehouseId: inactive,
        variantId: v,
        quantity: 1,
      }).expect(400);
      expect(toInactive.body.error.details[0].path).toBe('toWarehouseId');
      await post('/inventory/transfers', {
        fromWarehouseId: a,
        toWarehouseId: a,
        variantId: v,
        quantity: 1,
      }).expect(400);
    });
  });

  describe('reservations', () => {
    it('reserves several lines at once and releases them idempotently', async () => {
      const [w, v1, v2] = [await warehouse(), await variantId(), await variantId()];
      await receive(w, v1, 5).expect(201);
      await receive(w, v2, 5).expect(201);
      const reservations = (
        await post('/inventory/reservations', {
          lines: [
            { warehouseId: w, variantId: v1, quantity: 2 },
            { warehouseId: w, variantId: v2, quantity: 5 },
          ],
          reference: 'Trade show samples',
        }).expect(201)
      ).body;
      expect(reservations).toHaveLength(2);
      expect(reservations[0]).toMatchObject({
        status: 'ACTIVE',
        quantity: 2,
        reference: 'Trade show samples',
      });
      expect(await level(w, v2)).toMatchObject({ reserved: 5, available: 0 });

      const released = (
        await post(`/inventory/reservations/${reservations[1].id}/release`, {}).expect(200)
      ).body;
      expect(released.status).toBe('RELEASED');
      expect(released.releasedAt).not.toBeNull();
      await post(`/inventory/reservations/${reservations[1].id}/release`, {}).expect(200);
      expect(await level(w, v2)).toMatchObject({ reserved: 0, available: 5 });

      const active = (
        await get(`/inventory/reservations?status=ACTIVE&variantId=${v1}`).expect(200)
      ).body;
      expect(active.total).toBe(1);
    });

    it('is all or nothing: one short line reports every shortage and reserves nothing', async () => {
      const w = await warehouse();
      const [v1, v2, v3] = [await variantId(), await variantId(), await variantId()];
      await receive(w, v1, 5).expect(201);
      await receive(w, v2, 1).expect(201);
      const response = await post('/inventory/reservations', {
        lines: [
          { warehouseId: w, variantId: v1, quantity: 5 },
          { warehouseId: w, variantId: v2, quantity: 2 },
          { warehouseId: w, variantId: v3, quantity: 1 },
        ],
        reference: 'Big order',
      }).expect(409);
      expect(response.body.error.details).toEqual([
        { path: 'lines.1.quantity', message: 'Only 1 available' },
        { path: 'lines.2.quantity', message: 'No stock available' },
      ]);
      expect(await level(w, v1)).toMatchObject({ reserved: 0 });
      const reservations = (await get(`/inventory/reservations?variantId=${v1}`).expect(200)).body;
      expect(reservations.total).toBe(0);
    });
  });

  describe('low stock', () => {
    it('flags a level at or under its reorder point and records the crossing once', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      const created = (await receive(w, v, 10).expect(201)).body;
      await t
        .http()
        .patch(`/api/v1/inventory/levels/${created.id}`)
        .set(manager.auth)
        .send({ reorderPoint: 4 })
        .expect(200);
      await post('/inventory/reservations', {
        lines: [{ warehouseId: w, variantId: v, quantity: 6 }],
        reference: 'Crossing',
      }).expect(201);
      await post('/inventory/reservations', {
        lines: [{ warehouseId: w, variantId: v, quantity: 1 }],
        reference: 'Already low',
      }).expect(201);

      const low = (await get(`/inventory/levels?lowStock=true&warehouseId=${w}`).expect(200)).body;
      expect(low.items.map((l: { id: string }) => l.id)).toEqual([created.id]);
      expect(low.items[0]).toMatchObject({ available: 3, reorderPoint: 4, isLowStock: true });
      const { rows } = await t.db.query(
        `select payload from outbox_events
          where type = 'inventory.low_stock' and payload->>'inventoryLevelId' = $1`,
        [created.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({ available: 4, reorderPoint: 4 });
    });
  });

  describe('concurrency', () => {
    it('many simultaneous reservations for the last units never oversell', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      await receive(w, v, 10).expect(201);
      const attempts = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          post('/inventory/reservations', {
            lines: [{ warehouseId: w, variantId: v, quantity: 1 }],
            reference: `Buyer ${i}`,
          }),
        ),
      );
      const statuses = attempts.map((response) => response.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(10);
      expect(statuses.filter((status) => status === 409)).toHaveLength(20);
      expect(await level(w, v)).toMatchObject({ onHand: 10, reserved: 10, available: 0 });
    });

    it('uneven concurrent requests take only what fits', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      await receive(w, v, 10).expect(201);
      const attempts = await Promise.all(
        Array.from({ length: 12 }, () =>
          post('/inventory/reservations', {
            lines: [{ warehouseId: w, variantId: v, quantity: 3 }],
            reference: 'Batch',
          }),
        ),
      );
      expect(attempts.filter((response) => response.status === 201)).toHaveLength(3);
      expect(await level(w, v)).toMatchObject({ reserved: 9, available: 1 });
    });

    it('opposite transfers running at the same time do not deadlock and conserve stock', async () => {
      const [a, b, v] = [await warehouse(), await warehouse(), await variantId()];
      await receive(a, v, 50).expect(201);
      await receive(b, v, 50).expect(201);
      const attempts = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          post('/inventory/transfers', {
            fromWarehouseId: i % 2 === 0 ? a : b,
            toWarehouseId: i % 2 === 0 ? b : a,
            variantId: v,
            quantity: 1 + (i % 3),
          }),
        ),
      );
      expect(attempts.map((response) => response.status)).toEqual(Array(20).fill(201));
      const [la, lb] = [await level(a, v), await level(b, v)];
      expect(la.onHand + lb.onHand).toBe(100);
    });

    it('concurrent removals cannot drive stock below zero', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      await receive(w, v, 5).expect(201);
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          post('/inventory/adjustments', {
            warehouseId: w,
            variantId: v,
            reason: 'LOST',
            quantityChange: -1,
          }),
        ),
      );
      expect(attempts.filter((response) => response.status === 201)).toHaveLength(5);
      expect(await level(w, v)).toMatchObject({ onHand: 0 });
    });
  });

  describe('ledger integrity', () => {
    it('every level equals the sum of its movements, and reserved equals active reservations', async () => {
      const { rows } = await t.db.query(
        `select l.id, l.on_hand, l.reserved,
                coalesce((select sum(m.on_hand_change) from inventory_movements m
                           where m.inventory_level_id = l.id), 0)::int as ledger_on_hand,
                coalesce((select sum(m.reserved_change) from inventory_movements m
                           where m.inventory_level_id = l.id), 0)::int as ledger_reserved,
                coalesce((select sum(r.quantity) from inventory_reservations r
                           where r.inventory_level_id = l.id and r.status = 'ACTIVE'), 0)::int
                  as active_reserved
           from inventory_levels l where l.organization_id = $1`,
        [org],
      );
      expect(rows.length).toBeGreaterThan(10);
      for (const row of rows) {
        expect(row.ledger_on_hand, row.id).toBe(row.on_hand);
        expect(row.ledger_reserved, row.id).toBe(row.reserved);
        expect(row.active_reserved, row.id).toBe(row.reserved);
      }
    });

    it('the latest movement of each level carries the level’s current balance', async () => {
      const { rows } = await t.db.query(
        `select l.on_hand, l.reserved, m.on_hand_after, m.reserved_after
           from inventory_levels l
           join lateral (select * from inventory_movements m where m.inventory_level_id = l.id
                          order by m.sequence desc limit 1) m on true
          where l.organization_id = $1`,
        [org],
      );
      expect(rows.length).toBeGreaterThan(10);
      for (const row of rows) {
        expect(row.on_hand_after).toBe(row.on_hand);
        expect(row.reserved_after).toBe(row.reserved);
      }
    });
  });

  describe('permissions', () => {
    it('viewers read stock but cannot change it; staff can adjust and reserve', async () => {
      const [w, v] = [await warehouse(), await variantId()];
      const viewer = await t.actor(org, 'VIEWER');
      const staff = await t.actor(org, 'STAFF');
      await get('/inventory/levels', viewer).expect(200);
      await get('/inventory/movements', viewer).expect(200);
      const denied = await post(
        '/inventory/adjustments',
        { warehouseId: w, variantId: v, reason: 'RECEIVED', quantityChange: 1 },
        viewer,
      ).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      await post(
        '/inventory/reservations',
        { lines: [{ warehouseId: w, variantId: v, quantity: 1 }], reference: 'x' },
        viewer,
      ).expect(403);

      await post(
        '/inventory/adjustments',
        { warehouseId: w, variantId: v, reason: 'RECEIVED', quantityChange: 2 },
        staff,
      ).expect(201);
      await post(
        '/inventory/reservations',
        { lines: [{ warehouseId: w, variantId: v, quantity: 1 }], reference: 'Staff hold' },
        staff,
      ).expect(201);
    });
  });
});
