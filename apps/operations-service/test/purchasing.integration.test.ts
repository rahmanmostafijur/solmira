import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Purchasing against real PostgreSQL: the order lifecycle, draft locking, server-side totals,
 * separation of duties, and receiving, which must move order lines, stock, the ledger and the
 * receipt record together, exactly once, however many operators press "receive" at once.
 */
describe('purchasing API (real PostgreSQL)', () => {
  let t: TestApp;
  let buyer: Actor;
  let approver: Actor;
  let staff: Actor;
  let viewer: Actor;
  const org = newOrganizationId();
  let seq = 0;

  const call = (as: Actor) => ({
    get: (path: string) => t.http().get(`/api/v1${path}`).set(as.auth),
    post: (path: string, body: object = {}) =>
      t.http().post(`/api/v1${path}`).set(as.auth).send(body),
    patch: (path: string, body: object) => t.http().patch(`/api/v1${path}`).set(as.auth).send(body),
    delete: (path: string) => t.http().delete(`/api/v1${path}`).set(as.auth),
  });
  const api = () => call(buyer);

  async function supplier(): Promise<string> {
    seq += 1;
    return (
      await api()
        .post('/suppliers', { companyName: `Supplier ${seq}` })
        .expect(201)
    ).body.id;
  }
  async function warehouse(): Promise<string> {
    seq += 1;
    return (
      await api()
        .post('/warehouses', { code: `PWH-${seq}`, name: `Site ${seq}` })
        .expect(201)
    ).body.id;
  }
  async function variant(): Promise<{ id: string; productId: string }> {
    seq += 1;
    const product = (
      await api()
        .post('/products', {
          name: `Bought Product ${seq}`,
          basePrice: 2000,
          currency: 'USD',
          initialVariant: { sku: `BUY-${seq}` },
        })
        .expect(201)
    ).body;
    const id = (await api().get(`/products/${product.id}/variants`).expect(200)).body.items[0].id;
    return { id, productId: product.id };
  }

  interface Setup {
    supplierId: string;
    warehouseId: string;
    variants: string[];
  }
  async function setup(variantCount = 1): Promise<Setup> {
    const variants = [];
    for (let i = 0; i < variantCount; i += 1) variants.push((await variant()).id);
    return { supplierId: await supplier(), warehouseId: await warehouse(), variants };
  }

  async function draft(s: Setup, quantities: number[], extra: object = {}) {
    return (
      await api()
        .post('/purchase-orders', {
          supplierId: s.supplierId,
          warehouseId: s.warehouseId,
          currency: 'USD',
          items: quantities.map((quantity, i) => ({
            variantId: s.variants[i]!,
            quantity,
            unitCost: 1000,
          })),
          ...extra,
        })
        .expect(201)
    ).body;
  }

  async function approved(s: Setup, quantities: number[]) {
    const order = await draft(s, quantities);
    await api().post(`/purchase-orders/${order.id}/submit`).expect(200);
    return (await call(approver).post(`/purchase-orders/${order.id}/approve`).expect(200)).body;
  }

  const receive = (
    orderId: string,
    lines: { purchaseOrderItemId: string; quantity: number }[],
    key: string = randomUUID(),
    as: Actor = staff,
  ) =>
    t
      .http()
      .post(`/api/v1/purchase-orders/${orderId}/receipts`)
      .set(as.auth)
      .set('Idempotency-Key', key)
      .send({ lines });

  const level = async (warehouseId: string, variantId: string) =>
    (
      await api()
        .get(`/inventory/levels?warehouseId=${warehouseId}&variantId=${variantId}`)
        .expect(200)
    ).body.items[0];

  beforeAll(async () => {
    t = await createTestApp();
    t.app.getHttpServer().setMaxListeners(64);
    buyer = await t.actor(org, 'MANAGER');
    approver = await t.actor(org, 'MANAGER');
    staff = await t.actor(org, 'STAFF');
    viewer = await t.actor(org, 'VIEWER');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('drafts', () => {
    it('numbers orders per organization and computes every total on the server', async () => {
      const s = await setup(2);
      const order = (
        await api()
          .post('/purchase-orders', {
            supplierId: s.supplierId,
            warehouseId: s.warehouseId,
            currency: 'usd',
            shippingCost: 500,
            // A client-computed total is not part of the contract and is ignored.
            total: 1,
            items: [
              { variantId: s.variants[0], quantity: 10, unitCost: 1250, taxRateBps: 1500 },
              { variantId: s.variants[1], quantity: 3, unitCost: 333, taxRateBps: 750 },
            ],
          })
          .expect(201)
      ).body;
      expect(order.number).toMatch(/^PO-\d{4}-\d{6}$/);
      expect(order).toMatchObject({ status: 'DRAFT', currency: 'USD', itemCount: 2 });
      // 12,500 + 1,875 tax; 999 + 74.925 → 75 tax (half-up); shipping 500.
      expect(order).toMatchObject({
        subtotal: 13_499,
        tax: 1_950,
        shippingCost: 500,
        total: 15_949,
      });
      expect(order.items[1]).toMatchObject({ subtotal: 999, tax: 75, total: 1_074 });

      const next = await draft(s, [1]);
      const [a, b] = [order.number, next.number].map((n: string) => Number(n.slice(-6)));
      expect(b).toBe(a! + 1);

      const other = await t.actor(newOrganizationId(), 'OWNER');
      const otherSupplier = (
        await call(other).post('/suppliers', { companyName: 'Elsewhere' }).expect(201)
      ).body.id;
      const otherWarehouse = (
        await call(other).post('/warehouses', { code: 'ELSE', name: 'Elsewhere' }).expect(201)
      ).body.id;
      const first = (
        await call(other)
          .post('/purchase-orders', {
            supplierId: otherSupplier,
            warehouseId: otherWarehouse,
            currency: 'EUR',
          })
          .expect(201)
      ).body;
      expect(first.number.slice(-6)).toBe('000001');
    });

    it('edits lines of a draft and recalculates, one line per variant', async () => {
      const s = await setup(2);
      const order = await draft(s, [5]);
      const added = (
        await api()
          .post(`/purchase-orders/${order.id}/items`, {
            variantId: s.variants[1],
            quantity: 2,
            unitCost: 700,
          })
          .expect(201)
      ).body;
      expect(added.total).toBe(5 * 1000 + 2 * 700);
      const duplicate = await api()
        .post(`/purchase-orders/${order.id}/items`, {
          variantId: s.variants[1],
          quantity: 1,
          unitCost: 1,
        })
        .expect(409);
      expect(duplicate.body.error.message).toMatch(/already on the order/);

      const line = added.items[1].id;
      const changed = (
        await api().patch(`/purchase-orders/${order.id}/items/${line}`, { quantity: 4 }).expect(200)
      ).body;
      expect(changed.total).toBe(5 * 1000 + 4 * 700);
      const removed = (await api().delete(`/purchase-orders/${order.id}/items/${line}`).expect(200))
        .body;
      expect(removed).toMatchObject({ itemCount: 1, total: 5000 });
      const withShipping = (
        await api().patch(`/purchase-orders/${order.id}`, { shippingCost: 250 }).expect(200)
      ).body;
      expect(withShipping.total).toBe(5250);
    });

    it('never changes the currency under existing line costs', async () => {
      const s = await setup(1);
      const order = await draft(s, [2]);
      const response = await api()
        .patch(`/purchase-orders/${order.id}`, { currency: 'JPY' })
        .expect(409);
      expect(response.body.error.details[0].path).toBe('currency');
      await api().delete(`/purchase-orders/${order.id}/items/${order.items[0].id}`).expect(200);
      const empty = (
        await api().patch(`/purchase-orders/${order.id}`, { currency: 'JPY' }).expect(200)
      ).body;
      expect(empty.currency).toBe('JPY');
    });

    it('rejects inactive or unknown suppliers, warehouses and variants', async () => {
      const s = await setup(1);
      const inactiveSupplier = await supplier();
      await api().delete(`/suppliers/${inactiveSupplier}`).expect(204);
      const inactiveWarehouse = await warehouse();
      await api().delete(`/warehouses/${inactiveWarehouse}`).expect(204);
      const retired = await variant();
      await api()
        .patch(`/products/${retired.productId}/variants/${retired.id}`, { status: 'INACTIVE' })
        .expect(200);

      const attempt = (body: object) =>
        api()
          .post('/purchase-orders', {
            supplierId: s.supplierId,
            warehouseId: s.warehouseId,
            currency: 'USD',
            ...body,
          })
          .expect(400);
      expect((await attempt({ supplierId: inactiveSupplier })).body.error.details[0]).toEqual({
        path: 'supplierId',
        message: 'Supplier is inactive',
      });
      expect((await attempt({ warehouseId: inactiveWarehouse })).body.error.details[0]).toEqual({
        path: 'warehouseId',
        message: 'Warehouse is inactive',
      });
      const lines = await attempt({
        items: [
          { variantId: s.variants[0], quantity: 1, unitCost: 1 },
          { variantId: retired.id, quantity: 1, unitCost: 1 },
          { variantId: randomUUID(), quantity: 1, unitCost: 1 },
        ],
      });
      expect(lines.body.error.details).toEqual([
        { path: 'items.1.variantId', message: 'Variant is not active' },
        { path: 'items.2.variantId', message: 'Variant not found' },
      ]);
    });

    it('applies the line cap to edited lines too, never answering with a 500', async () => {
      const s = await setup(1);
      const order = await draft(s, [1]);
      await api()
        .patch(`/purchase-orders/${order.id}/items/${order.items[0].id}`, {
          unitCost: 9_999_999_999,
        })
        .expect(200);
      const response = await api()
        .patch(`/purchase-orders/${order.id}/items/${order.items[0].id}`, { quantity: 999_999 })
        .expect(400);
      expect(response.body.error.details[0]).toEqual({
        path: 'unitCost',
        message: 'This line is too large',
      });
    });

    it('rejects invalid quantities, costs and tax rates', async () => {
      const s = await setup(1);
      for (const line of [
        { quantity: 0, unitCost: 1 },
        { quantity: -3, unitCost: 1 },
        { quantity: 1.5, unitCost: 1 },
        { quantity: 1, unitCost: -1 },
        { quantity: 1, unitCost: 12.5 },
        { quantity: 1, unitCost: 1, taxRateBps: 10_001 },
      ]) {
        await api()
          .post('/purchase-orders', {
            supplierId: s.supplierId,
            warehouseId: s.warehouseId,
            currency: 'USD',
            items: [{ variantId: s.variants[0], ...line }],
          })
          .expect(400);
      }
    });
  });

  describe('workflow', () => {
    it('submit locks business fields; notes and the expected date stay editable', async () => {
      const s = await setup(1);
      const order = await draft(s, [3]);
      const submitted = (await api().post(`/purchase-orders/${order.id}/submit`).expect(200)).body;
      expect(submitted).toMatchObject({ status: 'SUBMITTED', submittedBy: buyer.userId });
      expect(submitted.submittedAt).not.toBeNull();

      const locked = await api()
        .patch(`/purchase-orders/${order.id}`, { supplierId: await supplier(), shippingCost: 1 })
        .expect(409);
      expect(locked.body.error.details).toEqual([
        { path: 'supplierId', message: 'Locked after submission' },
        { path: 'shippingCost', message: 'Locked after submission' },
      ]);
      await api()
        .post(`/purchase-orders/${order.id}/items`, {
          variantId: (await variant()).id,
          quantity: 1,
          unitCost: 1,
        })
        .expect(409);
      await api()
        .patch(`/purchase-orders/${order.id}/items/${order.items[0].id}`, { quantity: 99 })
        .expect(409);
      const noted = (
        await api()
          .patch(`/purchase-orders/${order.id}`, {
            notes: 'Supplier confirmed by phone',
            expectedDeliveryDate: '2026-11-15',
          })
          .expect(200)
      ).body;
      expect(noted).toMatchObject({
        notes: 'Supplier confirmed by phone',
        expectedDeliveryDate: '2026-11-15',
      });
    });

    it('refuses to submit an empty order or one whose supplier went inactive', async () => {
      const s = await setup(1);
      const empty = (
        await api()
          .post('/purchase-orders', {
            supplierId: s.supplierId,
            warehouseId: s.warehouseId,
            currency: 'USD',
          })
          .expect(201)
      ).body;
      const response = await api().post(`/purchase-orders/${empty.id}/submit`).expect(400);
      expect(response.body.error.details).toEqual([
        { path: 'items', message: 'Add at least one line' },
      ]);

      const order = await draft(s, [1]);
      await api().delete(`/suppliers/${s.supplierId}`).expect(204);
      const inactive = await api().post(`/purchase-orders/${order.id}/submit`).expect(400);
      expect(inactive.body.error.details).toEqual([
        { path: 'supplierId', message: 'Supplier is inactive' },
      ]);
    });

    it('enforces the state machine for every action', async () => {
      const s = await setup(1);
      const order = await draft(s, [2]);
      const line = [{ purchaseOrderItemId: order.items[0].id, quantity: 1 }];
      const approveDraft = await call(approver)
        .post(`/purchase-orders/${order.id}/approve`)
        .expect(409);
      expect(approveDraft.body.error.code).toBe('CONFLICT');
      expect((await receive(order.id, line).expect(409)).body.error.message).toMatch(
        /Only approved/,
      );

      await api().post(`/purchase-orders/${order.id}/submit`).expect(200);
      await api().post(`/purchase-orders/${order.id}/submit`).expect(409);
      await receive(order.id, line).expect(409);
      await call(approver).post(`/purchase-orders/${order.id}/approve`).expect(200);
      await call(approver).post(`/purchase-orders/${order.id}/approve`).expect(409);

      await receive(order.id, [{ purchaseOrderItemId: order.items[0].id, quantity: 2 }]).expect(
        201,
      );
      const cancelReceived = await api()
        .post(`/purchase-orders/${order.id}/cancel`, { reason: 'Too late' })
        .expect(409);
      expect(cancelReceived.body.error.message).toMatch(/cannot be cancelled/);
      await api().patch(`/purchase-orders/${order.id}`, { notes: 'x' }).expect(409);
    });

    it('never lets the creator or submitter approve their own order', async () => {
      const s = await setup(1);
      const order = await draft(s, [1]);
      await api().post(`/purchase-orders/${order.id}/submit`).expect(200);
      const own = await api().post(`/purchase-orders/${order.id}/approve`).expect(403);
      expect(own.body.error.code).toBe('FORBIDDEN');

      const approvedOrder = (
        await call(approver).post(`/purchase-orders/${order.id}/approve`).expect(200)
      ).body;
      expect(approvedOrder).toMatchObject({ status: 'APPROVED', approvedBy: approver.userId });
    });

    it('cancels with a reason from any open state', async () => {
      const s = await setup(1);
      const order = await draft(s, [1]);
      await api().post(`/purchase-orders/${order.id}/cancel`, {}).expect(400);
      const cancelled = (
        await api()
          .post(`/purchase-orders/${order.id}/cancel`, { reason: 'Duplicate order' })
          .expect(200)
      ).body;
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Duplicate order',
        cancelledBy: buyer.userId,
      });
      await api().post(`/purchase-orders/${order.id}/cancel`, { reason: 'Again' }).expect(409);
    });
  });

  describe('receiving', () => {
    it('receives in parts, moving stock and the ledger with every receipt', async () => {
      const s = await setup(1);
      const order = await approved(s, [100]);
      const line = order.items[0].id;

      const first = (
        await receive(order.id, [{ purchaseOrderItemId: line, quantity: 40 }]).expect(201)
      ).body;
      expect(first.replayed).toBe(false);
      expect(first.purchaseOrder).toMatchObject({ status: 'PARTIALLY_RECEIVED' });
      expect(first.purchaseOrder.receiving).toMatchObject({
        orderedUnits: 100,
        receivedUnits: 40,
        remainingUnits: 60,
        receiptCount: 1,
      });
      expect(first.receipt).toMatchObject({ receivedBy: staff.userId, purchaseOrderId: order.id });
      expect(first.receipt.lines).toMatchObject([{ purchaseOrderItemId: line, quantity: 40 }]);
      expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 40 });

      await receive(order.id, [{ purchaseOrderItemId: line, quantity: 30 }]).expect(201);
      const last = (
        await receive(order.id, [{ purchaseOrderItemId: line, quantity: 30 }]).expect(201)
      ).body;
      expect(last.purchaseOrder).toMatchObject({ status: 'RECEIVED' });
      expect(last.purchaseOrder.receivedAt).not.toBeNull();
      expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 100 });

      const ledger = (
        await api()
          .get(`/inventory/movements?variantId=${s.variants[0]}&type=PURCHASE_RECEIPT`)
          .expect(200)
      ).body.items;
      expect(ledger.map((m: { onHandChange: number }) => m.onHandChange)).toEqual([30, 30, 40]);
      expect(ledger[0]).toMatchObject({
        referenceType: 'PURCHASE_RECEIPT',
        referenceId: last.receipt.id,
      });
      expect(ledger[0].id).toBe(last.receipt.lines[0].inventoryMovementId);

      const receipts = (await api().get(`/purchase-orders/${order.id}/receipts`).expect(200)).body;
      expect(receipts).toHaveLength(3);
      expect(receipts[0].id).toBe(last.receipt.id);
      await receive(order.id, [{ purchaseOrderItemId: line, quantity: 1 }]).expect(409);
    });

    it('rejects over-receiving and leaves everything unchanged', async () => {
      const s = await setup(2);
      const order = await approved(s, [100, 10]);
      const [a, b] = order.items.map((item: { id: string }) => item.id);
      await receive(order.id, [{ purchaseOrderItemId: a, quantity: 40 }]).expect(201);

      const over = await receive(order.id, [
        { purchaseOrderItemId: b, quantity: 5 },
        { purchaseOrderItemId: a, quantity: 61 },
      ]).expect(409);
      expect(over.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'Cannot receive more than was ordered',
        details: [{ path: 'lines.1.quantity', message: 'Only 60 remaining' }],
      });
      const unchanged = (await api().get(`/purchase-orders/${order.id}`).expect(200)).body;
      expect(
        unchanged.items.map((item: { receivedQuantity: number }) => item.receivedQuantity),
      ).toEqual([40, 0]);
      expect(await level(s.warehouseId, s.variants[1]!)).toBeUndefined();
      expect(unchanged.receiving.receiptCount).toBe(1);

      const multi = (
        await receive(order.id, [
          { purchaseOrderItemId: a, quantity: 60 },
          { purchaseOrderItemId: b, quantity: 4 },
        ]).expect(201)
      ).body;
      expect(multi.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');
      expect(multi.receipt.lines).toHaveLength(2);
    });

    it('rejects lines of other orders and invalid quantities', async () => {
      const s = await setup(1);
      const order = await approved(s, [5]);
      const other = await approved(await setup(1), [5]);
      const foreign = await receive(order.id, [
        { purchaseOrderItemId: other.items[0].id, quantity: 1 },
      ]).expect(400);
      expect(foreign.body.error.details[0]).toEqual({
        path: 'lines.0.purchaseOrderItemId',
        message: 'Not a line of this purchase order',
      });
      for (const quantity of [0, -1, 2.5]) {
        await receive(order.id, [{ purchaseOrderItemId: order.items[0].id, quantity }]).expect(400);
      }
    });

    it('cancelling a partially received order closes the rest and keeps the stock', async () => {
      const s = await setup(1);
      const order = await approved(s, [10]);
      await receive(order.id, [{ purchaseOrderItemId: order.items[0].id, quantity: 4 }]).expect(
        201,
      );
      const cancelled = (
        await api()
          .post(`/purchase-orders/${order.id}/cancel`, {
            reason: 'Supplier cannot deliver the rest',
          })
          .expect(200)
      ).body;
      expect(cancelled).toMatchObject({ status: 'CANCELLED' });
      expect(cancelled.receiving).toMatchObject({ receivedUnits: 4, remainingUnits: 6 });
      expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 4 });
      await receive(order.id, [{ purchaseOrderItemId: order.items[0].id, quantity: 1 }]).expect(
        409,
      );
    });

    it('a failure on any line rolls back the whole receipt: lines, stock, ledger, record', async () => {
      const s = await setup(2);
      const order = await approved(s, [5, 5]);
      // The second variant's level sits at the stock ceiling (seeded with its ledger row), so
      // its receipt line must fail after the first line has already been processed.
      const seeded = (
        await api()
          .post('/inventory/adjustments', {
            warehouseId: s.warehouseId,
            variantId: s.variants[1]!,
            reason: 'RECEIVED',
            quantityChange: 1,
          })
          .expect(201)
      ).body;
      await t.db.query(`update inventory_levels set on_hand = 999999999 where id = $1`, [
        seeded.id,
      ]);
      await t.db.query(
        `insert into inventory_movements (id, organization_id, inventory_level_id, type, reason,
           on_hand_change, reserved_change, on_hand_after, reserved_after, correlation_id)
         values (gen_random_uuid(), $1, $2, 'ADJUSTMENT', 'CORRECTION', 999999998, 0, 999999999, 0, 'seed')`,
        [org, seeded.id],
      );

      const [first, second] = order.items;
      const response = await receive(order.id, [
        { purchaseOrderItemId: first.id, quantity: 5 },
        { purchaseOrderItemId: second.id, quantity: 5 },
      ]).expect(400);
      expect(response.body.error.details[0]).toEqual({
        path: 'lines.1.quantity',
        message: 'Stock cannot exceed 1,000,000,000 units',
      });

      const after = (await api().get(`/purchase-orders/${order.id}`).expect(200)).body;
      expect(after.status).toBe('APPROVED');
      expect(
        after.items.map((item: { receivedQuantity: number }) => item.receivedQuantity),
      ).toEqual([0, 0]);
      expect(after.receiving.receiptCount).toBe(0);
      expect(await level(s.warehouseId, s.variants[0]!)).toBeUndefined();
      const { rows } = await t.db.query(
        `select count(*)::int as n from outbox_events where payload->>'purchaseOrderId' = $1
            and type in ('inventory.received', 'purchase_order.received', 'purchase_order.partially_received')`,
        [order.id],
      );
      expect(rows[0].n).toBe(0);
    });

    it('will not receive into a warehouse that was deactivated after approval', async () => {
      const s = await setup(1);
      const order = await approved(s, [3]);
      await api().delete(`/warehouses/${s.warehouseId}`).expect(204);
      const response = await receive(order.id, [
        { purchaseOrderItemId: order.items[0].id, quantity: 1 },
      ]).expect(409);
      expect(response.body.error.message).toMatch(/warehouse is inactive/);
    });
  });

  describe('idempotency', () => {
    it('a retried receipt with the same key is returned, not received twice', async () => {
      const s = await setup(1);
      const order = await approved(s, [10]);
      const lines = [{ purchaseOrderItemId: order.items[0].id, quantity: 3 }];
      const key = randomUUID();
      const first = (await receive(order.id, lines, key).expect(201)).body;
      const retry = (await receive(order.id, lines, key).expect(200)).body;
      expect(retry.replayed).toBe(true);
      expect(retry.receipt.id).toBe(first.receipt.id);
      expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 3 });
      const receipts = (await api().get(`/purchase-orders/${order.id}/receipts`).expect(200)).body;
      expect(receipts).toHaveLength(1);
    });

    it('the same key with a different request is a conflict', async () => {
      const s = await setup(1);
      const order = await approved(s, [10]);
      const key = randomUUID();
      const line = order.items[0].id;
      await receive(order.id, [{ purchaseOrderItemId: line, quantity: 3 }], key).expect(201);
      const reused = await receive(
        order.id,
        [{ purchaseOrderItemId: line, quantity: 4 }],
        key,
      ).expect(409);
      expect(reused.body.error.details).toEqual([
        { path: 'Idempotency-Key', message: 'Use a new key for a new receipt' },
      ]);
      const otherOrder = await approved(await setup(1), [10]);
      await receive(
        otherOrder.id,
        [{ purchaseOrderItemId: otherOrder.items[0].id, quantity: 3 }],
        key,
      ).expect(409);
    });

    it('requires a well-formed Idempotency-Key', async () => {
      const s = await setup(1);
      const order = await approved(s, [10]);
      const lines = [{ purchaseOrderItemId: order.items[0].id, quantity: 1 }];
      const missing = await t
        .http()
        .post(`/api/v1/purchase-orders/${order.id}/receipts`)
        .set(staff.auth)
        .send({ lines })
        .expect(400);
      expect(missing.body.error.details[0].path).toBe('Idempotency-Key');
      await receive(order.id, lines, 'short').expect(400);
      await receive(order.id, lines, 'has spaces in it').expect(400);
    });

    it('concurrent duplicates of one receipt produce exactly one receipt', async () => {
      const s = await setup(1);
      const order = await approved(s, [50]);
      const key = randomUUID();
      const lines = [{ purchaseOrderItemId: order.items[0].id, quantity: 7 }];
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () => receive(order.id, lines, key)),
      );
      expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
      expect(attempts.filter((r) => r.status === 200)).toHaveLength(7);
      expect(new Set(attempts.map((r) => r.body.receipt.id)).size).toBe(1);
      expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 7 });
    });
  });

  describe('concurrency', () => {
    it('ten operators receiving 5 each against 20 remaining accept exactly 20', async () => {
      const s = await setup(1);
      const order = await approved(s, [20]);
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          receive(order.id, [{ purchaseOrderItemId: order.items[0].id, quantity: 5 }]),
        ),
      );
      const statuses = attempts.map((r) => r.status);
      expect(statuses.filter((status) => status === 201)).toHaveLength(4);
      expect(statuses.filter((status) => status === 409)).toHaveLength(6);

      const final = (await api().get(`/purchase-orders/${order.id}`).expect(200)).body;
      expect(final).toMatchObject({ status: 'RECEIVED' });
      expect(final.items[0]).toMatchObject({ receivedQuantity: 20, remainingQuantity: 0 });
      expect(final.receiving.receiptCount).toBe(4);
      expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 20 });
      const ledger = (
        await api()
          .get(`/inventory/movements?variantId=${s.variants[0]}&type=PURCHASE_RECEIPT`)
          .expect(200)
      ).body;
      expect(ledger.total).toBe(4);
    });

    it('first receipts of the same new variants in opposite line order do not deadlock', async () => {
      for (let round = 0; round < 4; round += 1) {
        const s = await setup(2);
        const [one, two] = await Promise.all([approved(s, [3, 3]), approved(s, [3, 3])]);
        const results = await Promise.all([
          receive(one.id, [
            { purchaseOrderItemId: one.items[0].id, quantity: 3 },
            { purchaseOrderItemId: one.items[1].id, quantity: 3 },
          ]),
          receive(two.id, [
            { purchaseOrderItemId: two.items[1].id, quantity: 3 },
            { purchaseOrderItemId: two.items[0].id, quantity: 3 },
          ]),
        ]);
        expect(results.map((r) => r.status)).toEqual([201, 201]);
        expect(await level(s.warehouseId, s.variants[0]!)).toMatchObject({ onHand: 6 });
        expect(await level(s.warehouseId, s.variants[1]!)).toMatchObject({ onHand: 6 });
      }
    });

    it('receipts racing a cancellation never both win', async () => {
      const s = await setup(1);
      const order = await approved(s, [10]);
      const [receipt, cancel] = await Promise.all([
        receive(order.id, [{ purchaseOrderItemId: order.items[0].id, quantity: 10 }]),
        api().post(`/purchase-orders/${order.id}/cancel`, { reason: 'Race' }),
      ]);
      const final = (await api().get(`/purchase-orders/${order.id}`).expect(200)).body;
      if (receipt.status === 201) {
        // Receipt first: fully received, so the cancellation must have been refused.
        expect(cancel.status).toBe(409);
        expect(final.status).toBe('RECEIVED');
      } else {
        expect(cancel.status).toBe(200);
        expect(receipt.status).toBe(409);
        expect(final.status).toBe('CANCELLED');
        expect(await level(s.warehouseId, s.variants[0]!)).toBeUndefined();
      }
    });
  });

  describe('permissions', () => {
    it('each action needs its own permission', async () => {
      const s = await setup(1);
      const order = await draft(s, [2]);
      await call(viewer).get('/purchase-orders').expect(200);
      await call(viewer).get(`/purchase-orders/${order.id}`).expect(200);
      const create = { supplierId: s.supplierId, warehouseId: s.warehouseId, currency: 'USD' };
      for (const [method, path, body] of [
        ['post', '/purchase-orders', create],
        ['patch', `/purchase-orders/${order.id}`, { notes: 'x' }],
        ['post', `/purchase-orders/${order.id}/submit`, {}],
        ['post', `/purchase-orders/${order.id}/approve`, {}],
        ['post', `/purchase-orders/${order.id}/cancel`, { reason: 'x' }],
      ] as const) {
        for (const actor of [viewer, staff]) {
          const response = await call(actor)[method](path, body);
          expect(response.status, `${method} ${path}`).toBe(403);
        }
      }
      await receive(
        order.id,
        [{ purchaseOrderItemId: order.items[0].id, quantity: 1 }],
        randomUUID(),
        viewer,
      ).expect(403);
      await t.http().get('/api/v1/purchase-orders').expect(401);
    });
  });

  describe('search', () => {
    it('finds orders by number, supplier name, status, supplier, warehouse and date', async () => {
      const s = await setup(1);
      const order = await draft(s, [1]);
      const byNumber = (
        await api()
          .get(`/purchase-orders?search=${order.number.slice(-6)}`)
          .expect(200)
      ).body;
      expect(byNumber.items.map((o: { id: string }) => o.id)).toContain(order.id);
      const byName = (
        await api()
          .get(`/purchase-orders?search=${encodeURIComponent(order.supplier.companyName)}`)
          .expect(200)
      ).body;
      expect(
        byName.items.every((o: { supplier: { id: string } }) => o.supplier.id === s.supplierId),
      ).toBe(true);
      const filtered = (
        await api()
          .get(
            `/purchase-orders?status=DRAFT&supplierId=${s.supplierId}&warehouseId=${s.warehouseId}` +
              '&createdFrom=2020-01-01&createdTo=2999-12-31',
          )
          .expect(200)
      ).body;
      expect(filtered.items.map((o: { id: string }) => o.id)).toEqual([order.id]);
      expect(filtered.items[0]).toMatchObject({ itemCount: 1, total: 1000 });
      const none = (
        await api()
          .get(`/purchase-orders?supplierId=${s.supplierId}&createdTo=2020-01-01`)
          .expect(200)
      ).body;
      expect(none.total).toBe(0);
      await api().get('/purchase-orders?pageSize=500').expect(400);
      await api().get('/purchase-orders?sort=secret').expect(400);
    });

    it('summarises a supplier’s purchasing without mixing currencies', async () => {
      const s = await setup(1);
      const received = await approved(s, [2]);
      await receive(received.id, [
        { purchaseOrderItemId: received.items[0].id, quantity: 2 },
      ]).expect(201);
      await draft(s, [1], { currency: 'EUR' });
      const cancelled = await draft(s, [9]);
      await api().post(`/purchase-orders/${cancelled.id}/cancel`, { reason: 'x' }).expect(200);
      const summary = (await api().get(`/suppliers/${s.supplierId}/purchasing-summary`).expect(200))
        .body;
      expect(summary.ordersByStatus).toMatchObject({ RECEIVED: 1, DRAFT: 1, CANCELLED: 1 });
      expect(summary.orderedValue).toEqual([
        { currency: 'EUR', total: 1000 },
        { currency: 'USD', total: 2000 },
      ]);
      expect(summary.receivedOrders).toBe(1);
      expect(summary.averageLeadTimeDays).not.toBeNull();
    });
  });

  describe('integrity', () => {
    it('orders, receipts, stock and the ledger agree after everything above', async () => {
      const lines = await t.db.query(
        `select i.id, i.ordered_quantity, i.received_quantity,
                coalesce((select sum(r.quantity) from purchase_receipt_items r
                           where r.purchase_order_item_id = i.id), 0)::int as receipted
           from purchase_order_items i where i.organization_id = $1`,
        [org],
      );
      expect(lines.rows.length).toBeGreaterThan(10);
      for (const row of lines.rows) {
        expect(row.receipted, row.id).toBe(row.received_quantity);
        expect(row.received_quantity).toBeLessThanOrEqual(row.ordered_quantity);
      }

      // Every receipt line produced exactly one PURCHASE_RECEIPT movement of the same size,
      // at the order's warehouse, for the line's variant, referencing the receipt.
      const mismatched = await t.db.query(
        `select ri.id from purchase_receipt_items ri
           join purchase_receipts r on r.id = ri.receipt_id
           join purchase_order_items i on i.id = ri.purchase_order_item_id
           join inventory_movements m on m.id = ri.inventory_movement_id
           join inventory_levels l on l.id = m.inventory_level_id
          where ri.organization_id = $1
            and not (m.type = 'PURCHASE_RECEIPT' and m.on_hand_change = ri.quantity
                     and m.reference_id = r.id and l.warehouse_id = r.warehouse_id
                     and l.variant_id = i.variant_id)`,
        [org],
      );
      expect(mismatched.rows).toEqual([]);
      const orphans = await t.db.query(
        `select m.id from inventory_movements m
          where m.organization_id = $1 and m.type = 'PURCHASE_RECEIPT'
            and not exists (select 1 from purchase_receipt_items ri
                             where ri.inventory_movement_id = m.id)`,
        [org],
      );
      expect(orphans.rows).toEqual([]);

      // Status reflects the aggregate of the lines.
      const statuses = await t.db.query(
        `select o.number, o.status, sum(i.ordered_quantity)::int as ordered,
                sum(i.received_quantity)::int as received
           from purchase_orders o join purchase_order_items i on i.purchase_order_id = o.id
          where o.organization_id = $1 group by o.id`,
        [org],
      );
      for (const row of statuses.rows) {
        if (row.status === 'RECEIVED') expect(row.received, row.number).toBe(row.ordered);
        if (row.status === 'PARTIALLY_RECEIVED') {
          expect(row.received, row.number).toBeGreaterThan(0);
          expect(row.received, row.number).toBeLessThan(row.ordered);
        }
        if (['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status))
          expect(row.received, row.number).toBe(0);
      }

      // And inventory still reconciles with its ledger.
      const levels = await t.db.query(
        `select l.id, l.on_hand, coalesce(sum(m.on_hand_change), 0)::int as ledger
           from inventory_levels l left join inventory_movements m on m.inventory_level_id = l.id
          where l.organization_id = $1 group by l.id`,
        [org],
      );
      for (const row of levels.rows) expect(row.ledger, row.id).toBe(row.on_hand);
    });
  });
});
