import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Organization B, holding owner tokens and A's real ids, attacks A's purchasing. B must not be
 * able to read, edit, submit, approve, cancel or receive A's orders, read A's lines or receipts,
 * or build its own orders from A's suppliers, warehouses or variants.
 */
describe('purchasing tenant isolation', () => {
  let t: TestApp;
  let a: Actor;
  let aApprover: Actor;
  let b: Actor;
  const ids = {} as {
    supplier: string;
    warehouse: string;
    variant: string;
    submitted: string;
    approved: string;
    approvedLine: string;
    bSupplier: string;
    bWarehouse: string;
  };

  const as = (actor: Actor) => ({
    get: (path: string) => t.http().get(`/api/v1${path}`).set(actor.auth),
    post: (path: string, body: object = {}) =>
      t.http().post(`/api/v1${path}`).set(actor.auth).send(body),
    patch: (path: string, body: object) =>
      t.http().patch(`/api/v1${path}`).set(actor.auth).send(body),
    delete: (path: string) => t.http().delete(`/api/v1${path}`).set(actor.auth),
  });

  async function order(status: 'SUBMITTED' | 'APPROVED') {
    const created = (
      await as(a)
        .post('/purchase-orders', {
          supplierId: ids.supplier,
          warehouseId: ids.warehouse,
          currency: 'USD',
          items: [{ variantId: ids.variant, quantity: 10, unitCost: 500 }],
        })
        .expect(201)
    ).body;
    await as(a).post(`/purchase-orders/${created.id}/submit`).expect(200);
    if (status === 'APPROVED')
      await as(aApprover).post(`/purchase-orders/${created.id}/approve`).expect(200);
    return created;
  }

  const aOrder = async (id: string) => (await as(a).get(`/purchase-orders/${id}`).expect(200)).body;

  beforeAll(async () => {
    t = await createTestApp();
    const orgA = newOrganizationId();
    a = await t.actor(orgA, 'MANAGER');
    aApprover = await t.actor(orgA, 'ADMIN');
    b = await t.actor(newOrganizationId(), 'OWNER');
    ids.supplier = (
      await as(a).post('/suppliers', { companyName: 'A Secret Supplier' }).expect(201)
    ).body.id;
    ids.warehouse = (
      await as(a).post('/warehouses', { code: 'A-DOCK', name: 'A Dock' }).expect(201)
    ).body.id;
    const product = (
      await as(a)
        .post('/products', {
          name: 'A Secret Part',
          basePrice: 100,
          currency: 'USD',
          initialVariant: { sku: 'A-PART' },
        })
        .expect(201)
    ).body;
    ids.variant = (
      await as(a).get(`/products/${product.id}/variants`).expect(200)
    ).body.items[0].id;
    ids.submitted = (await order('SUBMITTED')).id;
    const approved = await order('APPROVED');
    ids.approved = approved.id;
    ids.approvedLine = approved.items[0].id;
    await t
      .http()
      .post(`/api/v1/purchase-orders/${ids.approved}/receipts`)
      .set(a.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ purchaseOrderItemId: ids.approvedLine, quantity: 2 }] })
      .expect(201);
    ids.bSupplier = (
      await as(b).post('/suppliers', { companyName: 'B Supplier' }).expect(201)
    ).body.id;
    ids.bWarehouse = (
      await as(b).post('/warehouses', { code: 'B-DOCK', name: 'B Dock' }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await t.close();
  });

  it('B’s lists contain none of A’s orders, whatever the filter', async () => {
    for (const path of [
      '/purchase-orders',
      '/purchase-orders?search=secret',
      `/purchase-orders?supplierId=${ids.supplier}`,
      `/purchase-orders?warehouseId=${ids.warehouse}`,
    ]) {
      const response = await as(b).get(path).expect(200);
      expect(response.body.total, path).toBe(0);
    }
  });

  it('reading A’s order, lines, receipts or supplier summary is 404', async () => {
    for (const path of [
      `/purchase-orders/${ids.approved}`,
      `/purchase-orders/${ids.approved}/receipts`,
      `/suppliers/${ids.supplier}/purchasing-summary`,
    ]) {
      const response = await as(b).get(path).expect(404);
      expect(response.body.error.code, path).toBe('NOT_FOUND');
    }
  });

  it('every write to A’s orders is 404 and changes nothing', async () => {
    const attempts = [
      as(b).patch(`/purchase-orders/${ids.submitted}`, { notes: 'Hijacked' }),
      as(b).post(`/purchase-orders/${ids.submitted}/approve`),
      as(b).post(`/purchase-orders/${ids.submitted}/cancel`, { reason: 'Sabotage' }),
      as(b).post(`/purchase-orders/${ids.submitted}/submit`),
      as(b).post(`/purchase-orders/${ids.approved}/items`, {
        variantId: ids.variant,
        quantity: 1,
        unitCost: 1,
      }),
      as(b).patch(`/purchase-orders/${ids.approved}/items/${ids.approvedLine}`, { quantity: 1 }),
      as(b).delete(`/purchase-orders/${ids.approved}/items/${ids.approvedLine}`),
      t
        .http()
        .post(`/api/v1/purchase-orders/${ids.approved}/receipts`)
        .set(b.auth)
        .set('Idempotency-Key', randomUUID())
        .send({ lines: [{ purchaseOrderItemId: ids.approvedLine, quantity: 8 }] }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect(await aOrder(ids.submitted)).toMatchObject({ status: 'SUBMITTED', notes: null });
    const approved = await aOrder(ids.approved);
    expect(approved).toMatchObject({ status: 'PARTIALLY_RECEIVED' });
    expect(approved.items[0]).toMatchObject({ orderedQuantity: 10, receivedQuantity: 2 });
    expect(approved.receiving.receiptCount).toBe(1);
  });

  it('B cannot build orders from A’s supplier, warehouse or variant', async () => {
    const base = { supplierId: ids.bSupplier, warehouseId: ids.bWarehouse, currency: 'USD' };
    const bySupplier = await as(b)
      .post('/purchase-orders', { ...base, supplierId: ids.supplier })
      .expect(400);
    expect(bySupplier.body.error.details[0]).toEqual({
      path: 'supplierId',
      message: 'Supplier not found',
    });
    const byWarehouse = await as(b)
      .post('/purchase-orders', { ...base, warehouseId: ids.warehouse })
      .expect(400);
    expect(byWarehouse.body.error.details[0]).toEqual({
      path: 'warehouseId',
      message: 'Warehouse not found',
    });
    const byVariant = await as(b)
      .post('/purchase-orders', {
        ...base,
        items: [{ variantId: ids.variant, quantity: 1, unitCost: 1 }],
      })
      .expect(400);
    expect(byVariant.body.error.details[0]).toEqual({
      path: 'items.0.variantId',
      message: 'Variant not found',
    });

    const own = (await as(b).post('/purchase-orders', base).expect(201)).body;
    await as(b).patch(`/purchase-orders/${own.id}`, { supplierId: ids.supplier }).expect(400);
    await as(b).patch(`/purchase-orders/${own.id}`, { warehouseId: ids.warehouse }).expect(400);
    await as(b)
      .post(`/purchase-orders/${own.id}/items`, {
        variantId: ids.variant,
        quantity: 1,
        unitCost: 1,
      })
      .expect(400);
  });

  it('B cannot receive against its own order using A’s order lines', async () => {
    const product = (
      await as(b)
        .post('/products', {
          name: 'B Part',
          basePrice: 100,
          currency: 'USD',
          initialVariant: { sku: 'B-PART' },
        })
        .expect(201)
    ).body;
    const variantId = (await as(b).get(`/products/${product.id}/variants`).expect(200)).body
      .items[0].id;
    const own = (
      await as(b)
        .post('/purchase-orders', {
          supplierId: ids.bSupplier,
          warehouseId: ids.bWarehouse,
          currency: 'USD',
          items: [{ variantId, quantity: 5, unitCost: 10 }],
        })
        .expect(201)
    ).body;
    await as(b).post(`/purchase-orders/${own.id}/submit`).expect(200);
    const bApprover = await t.actor(b.organizationId, 'ADMIN');
    await as(bApprover).post(`/purchase-orders/${own.id}/approve`).expect(200);
    const response = await t
      .http()
      .post(`/api/v1/purchase-orders/${own.id}/receipts`)
      .set(b.auth)
      .set('Idempotency-Key', randomUUID())
      .send({ lines: [{ purchaseOrderItemId: ids.approvedLine, quantity: 1 }] })
      .expect(400);
    expect(response.body.error.details[0].path).toBe('lines.0.purchaseOrderItemId');
    expect((await aOrder(ids.approved)).items[0].receivedQuantity).toBe(2);
  });

  it('rejects malformed ids with 400 instead of querying', async () => {
    for (const path of ['/purchase-orders/abc', '/purchase-orders/1%20or%201=1/receipts']) {
      const response = await as(a).get(path).expect(400);
      expect(response.body.error.code, path).toBe('VALIDATION_FAILED');
    }
  });
});
