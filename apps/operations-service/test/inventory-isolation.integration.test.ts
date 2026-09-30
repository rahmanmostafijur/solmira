import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Organization B, with a valid owner token, attacking organization A's stock using A's real ids.
 * B must not see A's stock, move it, reserve it, release A's holds, or put stock into A's
 * warehouses; and every failed attempt must leave A's numbers exactly as they were.
 */
describe('inventory tenant isolation', () => {
  let t: TestApp;
  let a: Actor;
  let b: Actor;
  const ids = {} as {
    warehouse: string;
    variant: string;
    level: string;
    reservation: string;
    bWarehouse: string;
    bVariant: string;
  };

  const as = (actor: Actor) => ({
    get: (path: string) => t.http().get(`/api/v1${path}`).set(actor.auth),
    post: (path: string, body: object) =>
      t.http().post(`/api/v1${path}`).set(actor.auth).send(body),
    patch: (path: string, body: object) =>
      t.http().patch(`/api/v1${path}`).set(actor.auth).send(body),
  });

  async function stockedVariant(actor: Actor, code: string, sku: string) {
    const api = as(actor);
    const warehouse = (await api.post('/warehouses', { code, name: `${code} site` }).expect(201))
      .body.id;
    const product = (
      await api
        .post('/products', { name: sku, basePrice: 100, currency: 'USD', initialVariant: { sku } })
        .expect(201)
    ).body;
    const variant = (await api.get(`/products/${product.id}/variants`).expect(200)).body.items[0]
      .id;
    return { warehouse, variant };
  }

  const aLevel = async () => (await as(a).get(`/inventory/levels/${ids.level}`).expect(200)).body;

  beforeAll(async () => {
    t = await createTestApp();
    a = await t.actor(newOrganizationId(), 'MANAGER');
    b = await t.actor(newOrganizationId(), 'OWNER');
    const stockA = await stockedVariant(a, 'A-MAIN', 'A-STOCK');
    ids.warehouse = stockA.warehouse;
    ids.variant = stockA.variant;
    ids.level = (
      await as(a)
        .post('/inventory/adjustments', {
          warehouseId: ids.warehouse,
          variantId: ids.variant,
          reason: 'RECEIVED',
          quantityChange: 20,
        })
        .expect(201)
    ).body.id;
    ids.reservation = (
      await as(a)
        .post('/inventory/reservations', {
          lines: [{ warehouseId: ids.warehouse, variantId: ids.variant, quantity: 5 }],
          reference: 'A secret hold',
        })
        .expect(201)
    ).body[0].id;
    const stockB = await stockedVariant(b, 'B-MAIN', 'B-STOCK');
    ids.bWarehouse = stockB.warehouse;
    ids.bVariant = stockB.variant;
  });

  afterAll(async () => {
    await t.close();
  });

  it('B’s lists contain nothing of A’s, even filtered by A’s ids', async () => {
    for (const path of [
      '/inventory/levels',
      `/inventory/levels?warehouseId=${ids.warehouse}`,
      `/inventory/levels?variantId=${ids.variant}`,
      '/inventory/levels?search=A-STOCK',
      '/inventory/movements',
      `/inventory/movements?variantId=${ids.variant}`,
      '/inventory/reservations?search=secret',
      `/inventory/reservations?warehouseId=${ids.warehouse}`,
    ]) {
      const response = await as(b).get(path).expect(200);
      expect(response.body.total, path).toBe(0);
    }
  });

  it('reading or changing A’s level and releasing A’s hold are 404', async () => {
    await as(b).get(`/inventory/levels/${ids.level}`).expect(404);
    await as(b).patch(`/inventory/levels/${ids.level}`, { reorderPoint: 1000 }).expect(404);
    const release = await as(b).post(`/inventory/reservations/${ids.reservation}/release`, {});
    expect(release.status).toBe(404);
    expect(await aLevel()).toMatchObject({ onHand: 20, reserved: 5, reorderPoint: null });
  });

  it('B cannot adjust, transfer or reserve A’s stock with A’s ids', async () => {
    const attempts = [
      as(b).post('/inventory/adjustments', {
        warehouseId: ids.warehouse,
        variantId: ids.variant,
        reason: 'LOST',
        quantityChange: -20,
      }),
      as(b).post('/inventory/adjustments', {
        warehouseId: ids.warehouse,
        variantId: ids.variant,
        reason: 'COUNT',
        countedQuantity: 0,
      }),
      as(b).post('/inventory/transfers', {
        fromWarehouseId: ids.warehouse,
        toWarehouseId: ids.bWarehouse,
        variantId: ids.variant,
        quantity: 10,
      }),
      as(b).post('/inventory/reservations', {
        lines: [{ warehouseId: ids.warehouse, variantId: ids.variant, quantity: 15 }],
        reference: 'Stolen',
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      // A's ids simply do not exist for B: a field error, never a stock number of A's.
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(response.body)).not.toMatch(/available/i);
    }
    expect(await aLevel()).toMatchObject({ onHand: 20, reserved: 5 });
  });

  it('B cannot mix A’s warehouse with B’s variant or the other way round', async () => {
    const mixed = [
      { warehouseId: ids.warehouse, variantId: ids.bVariant },
      { warehouseId: ids.bWarehouse, variantId: ids.variant },
    ];
    for (const pair of mixed) {
      await as(b)
        .post('/inventory/adjustments', { ...pair, reason: 'RECEIVED', quantityChange: 5 })
        .expect(400);
    }
    // With stock of its own, B still cannot push it into A's warehouse.
    await as(b)
      .post('/inventory/adjustments', {
        warehouseId: ids.bWarehouse,
        variantId: ids.bVariant,
        reason: 'RECEIVED',
        quantityChange: 5,
      })
      .expect(201);
    const intoA = await as(b)
      .post('/inventory/transfers', {
        fromWarehouseId: ids.bWarehouse,
        toWarehouseId: ids.warehouse,
        variantId: ids.bVariant,
        quantity: 1,
      })
      .expect(400);
    expect(intoA.body.error.details[0]).toEqual({
      path: 'toWarehouseId',
      message: 'Warehouse not found',
    });
    const { rows } = await t.db.query(
      `select count(*)::int as n from inventory_levels
        where organization_id = $1 and (warehouse_id = $2 or variant_id = $3)`,
      [b.organizationId, ids.warehouse, ids.variant],
    );
    expect(rows[0].n).toBe(0);
  });

  it('rejects malformed ids with 400 instead of querying', async () => {
    for (const path of ['/inventory/levels/abc', '/inventory/levels?warehouseId=1%20or%201=1']) {
      const response = await as(a).get(path).expect(400);
      expect(response.body.error.code, path).toBe('VALIDATION_FAILED');
    }
    await as(a).post('/inventory/reservations/not-a-uuid/release', {}).expect(400);
  });
});
