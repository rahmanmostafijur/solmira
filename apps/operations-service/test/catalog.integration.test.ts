import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('catalog API (real PostgreSQL, JWKS-verified tokens)', () => {
  let t: TestApp;
  let manager: Actor;
  const org = newOrganizationId();

  const post = (path: string, body: object) =>
    t.http().post(`/api/v1${path}`).set(manager.auth).send(body);
  const patch = (path: string, body: object) =>
    t.http().patch(`/api/v1${path}`).set(manager.auth).send(body);
  const get = (path: string) => t.http().get(`/api/v1${path}`).set(manager.auth);

  beforeAll(async () => {
    t = await createTestApp();
    manager = await t.actor(org, 'MANAGER');
  });

  afterAll(async () => {
    await t.close();
  });

  describe('categories', () => {
    it('builds a hierarchy up to three levels and rejects a fourth', async () => {
      const root = (await post('/categories', { name: 'Footwear' }).expect(201)).body;
      const child = (await post('/categories', { name: 'Running', parentId: root.id }).expect(201))
        .body;
      const leaf = (
        await post('/categories', { name: 'Trail Running', parentId: child.id }).expect(201)
      ).body;
      expect(leaf).toMatchObject({ slug: 'trail-running', parentId: child.id, status: 'ACTIVE' });

      const tooDeep = await post('/categories', { name: 'Too Deep', parentId: leaf.id }).expect(
        400,
      );
      expect(tooDeep.body.error.details[0].path).toBe('parentId');
    });

    it('prevents moving a category under its own descendant', async () => {
      const a = (await post('/categories', { name: 'Apparel' }).expect(201)).body;
      const b = (await post('/categories', { name: 'Jackets', parentId: a.id }).expect(201)).body;
      await patch(`/categories/${a.id}`, { parentId: b.id }).expect(400);
    });

    it('deletes empty categories and refuses to delete categories in use', async () => {
      const empty = (await post('/categories', { name: 'Seasonal' }).expect(201)).body;
      await t.http().delete(`/api/v1/categories/${empty.id}`).set(manager.auth).expect(204);
      await get(`/categories/${empty.id}`).expect(404);

      const used = (await post('/categories', { name: 'Bags' }).expect(201)).body;
      await post('/products', {
        name: 'Canvas Tote',
        basePrice: 2500,
        currency: 'USD',
        categoryId: used.id,
      }).expect(201);
      const blocked = await t
        .http()
        .delete(`/api/v1/categories/${used.id}`)
        .set(manager.auth)
        .expect(409);
      expect(blocked.body.error.code).toBe('CONFLICT');
    });

    it('rejects duplicate slugs within the organization', async () => {
      await post('/categories', { name: 'Accessories', slug: 'accessories' }).expect(201);
      await post('/categories', { name: 'Accessories 2', slug: 'accessories' }).expect(409);
    });
  });

  describe('suppliers', () => {
    it('creates, validates, deactivates and restores', async () => {
      const created = await post('/suppliers', {
        companyName: 'Dhaka Leather Works',
        email: 'Orders@DhakaLeather.example',
        phone: '+880 2 5566 7788',
        country: 'bd',
        leadTimeDays: 21,
        paymentTerms: 'NET_45',
      }).expect(201);
      expect(created.body).toMatchObject({
        email: 'orders@dhakaleather.example',
        country: 'BD',
        phone: '+880 2 5566 7788',
        status: 'ACTIVE',
      });

      await t.http().delete(`/api/v1/suppliers/${created.body.id}`).set(manager.auth).expect(204);
      expect((await get(`/suppliers/${created.body.id}`).expect(200)).body.status).toBe('INACTIVE');
      expect(
        (await patch(`/suppliers/${created.body.id}`, { status: 'ACTIVE' }).expect(200)).body
          .status,
      ).toBe('ACTIVE');
    });

    it('rejects invalid input with field details and duplicate company names', async () => {
      const invalid = await post('/suppliers', {
        companyName: '',
        email: 'nope',
        phone: '12',
        leadTimeDays: 999,
      }).expect(400);
      expect(invalid.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'companyName',
        'email',
        'leadTimeDays',
        'phone',
      ]);
      await post('/suppliers', { companyName: 'Harbor Freight Co' }).expect(201);
      await post('/suppliers', { companyName: 'HARBOR FREIGHT CO' }).expect(409);
    });

    it('refuses products for an inactive supplier', async () => {
      const supplier = (
        await post('/suppliers', { companyName: 'Paused Supplier Ltd' }).expect(201)
      ).body;
      await t.http().delete(`/api/v1/suppliers/${supplier.id}`).set(manager.auth).expect(204);
      const response = await post('/products', {
        name: 'Orphan',
        basePrice: 100,
        currency: 'USD',
        supplierId: supplier.id,
      }).expect(400);
      expect(response.body.error.details[0].path).toBe('supplierId');
    });
  });

  describe('products and variants', () => {
    it('creates a product with its first variant and follows the lifecycle rules', async () => {
      const created = await post('/products', {
        name: 'Classic Running Shoe',
        brand: 'Stride',
        basePrice: 8999,
        baseCost: 4200,
        currency: 'usd',
        weightGrams: 780,
        initialVariant: { sku: 'crs-40-blk', name: 'Size 40 / Black' },
      }).expect(201);
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        currency: 'USD',
        variantCount: 1,
        primarySku: 'CRS-40-BLK',
        slug: 'classic-running-shoe',
      });
      const id = created.body.id;

      await patch(`/products/${id}`, { status: 'ACTIVE' }).expect(200);
      const draftAgain = await patch(`/products/${id}`, { status: 'DRAFT' }).expect(409);
      expect(draftAgain.body.error.code).toBe('CONFLICT');

      await t.http().delete(`/api/v1/products/${id}`).set(manager.auth).expect(204);
      const archived = (await get(`/products/${id}`).expect(200)).body;
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.archivedAt).not.toBeNull();
      expect(
        (await patch(`/products/${id}`, { status: 'INACTIVE' }).expect(200)).body.archivedAt,
      ).toBeNull();
    });

    it('requires an active variant before a product can be activated', async () => {
      const bare = (
        await post('/products', { name: 'Gift Card', basePrice: 5000, currency: 'USD' }).expect(201)
      ).body;
      const response = await patch(`/products/${bare.id}`, { status: 'ACTIVE' }).expect(409);
      expect(response.body.error.message).toMatch(/active variant/);
    });

    it('enforces SKU uniqueness per organization, frees archived SKUs, protects the last active variant', async () => {
      const product = (
        await post('/products', {
          name: 'Trail Sock',
          basePrice: 1200,
          currency: 'USD',
          initialVariant: { sku: 'SOCK-M' },
        }).expect(201)
      ).body;
      await post(`/products/${product.id}/variants`, { sku: 'sock-m', name: 'Duplicate' }).expect(
        409,
      );

      const large = (
        await post(`/products/${product.id}/variants`, {
          sku: 'SOCK-L',
          name: 'Large',
          price: 1400,
          attributes: { size: 'L' },
        }).expect(201)
      ).body;
      expect(large).toMatchObject({
        sku: 'SOCK-L',
        price: 1400,
        effectivePrice: 1400,
        attributes: { size: 'L' },
      });

      await patch(`/products/${product.id}`, { status: 'ACTIVE' }).expect(200);
      const variants = (await get(`/products/${product.id}/variants`).expect(200)).body.items;
      const medium = variants.find((v: { sku: string }) => v.sku === 'SOCK-M');
      expect(medium.effectivePrice).toBe(1200);

      await t
        .http()
        .delete(`/api/v1/products/${product.id}/variants/${medium.id}`)
        .set(manager.auth)
        .expect(204);
      await post(`/products/${product.id}/variants`, {
        sku: 'SOCK-M',
        name: 'Medium (new)',
      }).expect(201);

      const onlyLarge = await patch(`/products/${product.id}/variants/${large.id}`, {
        status: 'INACTIVE',
      });
      expect(onlyLarge.status).toBe(200);
      const remaining = (await get(`/products/${product.id}/variants?status=ACTIVE`).expect(200))
        .body.items;
      const last = await patch(`/products/${product.id}/variants/${remaining[0].id}`, {
        status: 'INACTIVE',
      }).expect(409);
      expect(last.body.error.message).toMatch(/at least one active variant/);
    });

    it('allows the same SKU in another organization', async () => {
      const other = await t.actor(newOrganizationId(), 'MANAGER');
      await t
        .http()
        .post('/api/v1/products')
        .set(other.auth)
        .send({
          name: 'Classic Running Shoe',
          basePrice: 100,
          currency: 'EUR',
          initialVariant: { sku: 'CRS-40-BLK' },
        })
        .expect(201);
    });

    it('applies bulk status changes per product and reports what was skipped', async () => {
      const ready = (
        await post('/products', {
          name: 'Bulk Ready',
          basePrice: 100,
          currency: 'USD',
          initialVariant: { sku: 'BULK-1' },
        }).expect(201)
      ).body;
      const empty = (
        await post('/products', { name: 'Bulk Empty', basePrice: 100, currency: 'USD' }).expect(201)
      ).body;
      const response = await post('/products/bulk-status', {
        productIds: [ready.id, empty.id, '0192f000-0000-7000-8000-000000000000'],
        status: 'ACTIVE',
      }).expect(200);
      expect(response.body.updated).toEqual([ready.id]);
      expect(response.body.skipped.map((s: { id: string }) => s.id)).toEqual([
        empty.id,
        '0192f000-0000-7000-8000-000000000000',
      ]);
    });
  });

  describe('listing: pagination, sorting, filtering and search', () => {
    let listOrg: Actor;
    let categoryId: string;
    let supplierId: string;

    beforeAll(async () => {
      listOrg = await t.actor(newOrganizationId(), 'MANAGER');
      const as = (path: string, body: object) =>
        t.http().post(`/api/v1${path}`).set(listOrg.auth).send(body).expect(201);
      categoryId = (await as('/categories', { name: 'Kitchen' })).body.id;
      supplierId = (await as('/suppliers', { companyName: 'Nordic Steelworks' })).body.id;
      for (const [index, name] of [
        'Chef Knife',
        'Paring Knife',
        'Cutting Board',
        'Knife Block',
        'Steel Pan',
      ].entries()) {
        await as('/products', {
          name,
          brand: index % 2 === 0 ? 'Fjord' : 'Valley',
          basePrice: (index + 1) * 1000,
          currency: 'EUR',
          categoryId: index < 3 ? categoryId : null,
          supplierId: index === 4 ? supplierId : null,
          initialVariant: { sku: `KIT-${index}` },
        });
      }
    });

    const list = (query: string) =>
      t.http().get(`/api/v1/products?${query}`).set(listOrg.auth).expect(200);

    it('paginates with totals and never returns more than the page size', async () => {
      const first = (await list('pageSize=2&sort=name&direction=asc')).body;
      expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
      expect(first.items.map((p: { name: string }) => p.name)).toEqual([
        'Chef Knife',
        'Cutting Board',
      ]);
      const third = (await list('pageSize=2&page=3&sort=name&direction=asc')).body;
      expect(third.items.map((p: { name: string }) => p.name)).toEqual(['Steel Pan']);
    });

    it('sorts by price in both directions', async () => {
      const desc = (await list('sort=basePrice&direction=desc')).body.items.map(
        (p: { basePrice: number }) => p.basePrice,
      );
      expect(desc).toEqual([5000, 4000, 3000, 2000, 1000]);
    });

    it('filters by category, supplier, brand, price range and SKU, and combines filters', async () => {
      expect((await list(`categoryId=${categoryId}`)).body.total).toBe(3);
      expect((await list(`supplierId=${supplierId}`)).body.items[0].name).toBe('Steel Pan');
      expect((await list('brand=fjord')).body.total).toBe(3);
      expect((await list('minPrice=2000&maxPrice=4000')).body.total).toBe(3);
      expect((await list('sku=kit-1')).body.items.map((p: { name: string }) => p.name)).toEqual([
        'Paring Knife',
      ]);
      expect((await list(`categoryId=${categoryId}&brand=Fjord&maxPrice=2000`)).body.total).toBe(1);
    });

    it('searches name, brand, SKU, category and supplier, with wildcard characters taken literally', async () => {
      expect((await list('search=knife')).body.total).toBe(3);
      expect((await list('search=KIT-3')).body.items[0].name).toBe('Knife Block');
      expect((await list('search=kitchen')).body.total).toBe(3);
      expect((await list('search=steelworks')).body.items[0].name).toBe('Steel Pan');
      expect((await list('search=%25')).body.total).toBe(0);
    });

    it('returns summaries only: category and supplier names, variant count, no nested collections', async () => {
      const item = (await list('search=Steel%20Pan')).body.items[0];
      expect(item).toMatchObject({
        supplier: { id: supplierId, companyName: 'Nordic Steelworks' },
        variantCount: 1,
        primarySku: 'KIT-4',
      });
      expect(item).not.toHaveProperty('variants');
      expect(item).not.toHaveProperty('images');
    });

    it('rejects invalid query parameters instead of guessing', async () => {
      for (const query of [
        'pageSize=500',
        'page=0',
        'sort=password',
        'status=DELETED',
        'categoryId=not-a-uuid',
        'minPrice=9&maxPrice=1',
        'createdFrom=yesterday',
      ]) {
        const response = await t
          .http()
          .get(`/api/v1/products?${query}`)
          .set(listOrg.auth)
          .expect(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('warehouses and managers', () => {
    it('lets two organizations use the same code, but not one organization twice', async () => {
      await post('/warehouses', {
        code: 'wh-dhk',
        name: 'Dhaka Central',
        city: 'Dhaka',
        country: 'BD',
      }).expect(201);
      await post('/warehouses', { code: 'WH-DHK', name: 'Duplicate' }).expect(409);
      const other = await t.actor(newOrganizationId(), 'MANAGER');
      await t
        .http()
        .post('/api/v1/warehouses')
        .set(other.auth)
        .send({ code: 'WH-DHK', name: 'Other Dhaka' })
        .expect(201);
    });

    it('assigns an active member of the same organization as manager, shown in lists', async () => {
      const rahim = t.members.add(org, {
        fullName: 'Rahim Uddin',
        email: 'rahim@northwind.test',
        status: 'active',
      });
      const created = await post('/warehouses', {
        code: 'WH-CTG',
        name: 'Chattogram Port',
        managerMemberId: rahim.memberId,
      }).expect(201);
      expect(created.body.manager).toEqual({
        memberId: rahim.memberId,
        fullName: 'Rahim Uddin',
        email: 'rahim@northwind.test',
      });
      const listed = (await get('/warehouses?search=chattogram').expect(200)).body.items[0];
      expect(listed.manager.fullName).toBe('Rahim Uddin');
    });

    it('rejects suspended members and members of other organizations', async () => {
      const suspended = t.members.add(org, {
        fullName: 'Sam Suspended',
        email: 'sam@northwind.test',
        status: 'suspended',
      });
      await post('/warehouses', {
        code: 'WH-SYL',
        name: 'Sylhet',
        managerMemberId: suspended.memberId,
      }).expect(400);

      const outsider = t.members.add(newOrganizationId(), {
        fullName: 'Olga Outsider',
        email: 'olga@harbor.test',
        status: 'active',
      });
      const response = await post('/warehouses', {
        code: 'WH-KHL',
        name: 'Khulna',
        managerMemberId: outsider.memberId,
      }).expect(400);
      expect(response.body.error.details[0]).toMatchObject({ path: 'managerMemberId' });
    });

    it('deactivates instead of deleting', async () => {
      const warehouse = (
        await post('/warehouses', { code: 'WH-TMP', name: 'Temporary' }).expect(201)
      ).body;
      await t.http().delete(`/api/v1/warehouses/${warehouse.id}`).set(manager.auth).expect(204);
      expect((await get(`/warehouses/${warehouse.id}`).expect(200)).body.status).toBe('INACTIVE');
    });
  });

  it('records catalog events in the outbox in the same transaction', async () => {
    const product = (
      await post('/products', {
        name: 'Evented',
        basePrice: 1,
        currency: 'USD',
        initialVariant: { sku: 'EVT-1' },
      }).expect(201)
    ).body;
    const { rows } = await t.db.query(
      `select type from outbox_events where payload->>'productId' = $1 order by occurred_at`,
      [product.id],
    );
    expect(rows.map((row) => row.type)).toEqual(['product.created', 'variant.created']);
  });
});
