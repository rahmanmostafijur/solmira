import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

/**
 * Attacks from organization B against organization A's catalog. Every request carries a valid,
 * JWKS-verified token for B; the only thing B controls is the IDs it sends. Nothing of A's may be
 * read, changed, referenced or even confirmed to exist.
 */
describe('catalog tenant isolation and permissions', () => {
  let t: TestApp;
  let a: Actor;
  let b: Actor;
  const ids = {} as {
    category: string;
    supplier: string;
    warehouse: string;
    product: string;
    variant: string;
  };

  beforeAll(async () => {
    t = await createTestApp();
    a = await t.actor(newOrganizationId(), 'MANAGER');
    b = await t.actor(newOrganizationId(), 'OWNER');
    const as = (path: string, body: object) =>
      t.http().post(`/api/v1${path}`).set(a.auth).send(body).expect(201);
    ids.category = (await as('/categories', { name: 'A Secret Category' })).body.id;
    ids.supplier = (await as('/suppliers', { companyName: 'A Secret Supplier' })).body.id;
    ids.warehouse = (await as('/warehouses', { code: 'A-HQ', name: 'A Headquarters' })).body.id;
    const product = (
      await as('/products', {
        name: 'A Secret Product',
        basePrice: 100,
        currency: 'USD',
        initialVariant: { sku: 'A-SECRET' },
      })
    ).body;
    ids.product = product.id;
    ids.variant = (
      await t.http().get(`/api/v1/products/${product.id}/variants`).set(a.auth).expect(200)
    ).body.items[0].id;
  });

  afterAll(async () => {
    await t.close();
  });

  describe('organization B cannot see organization A', () => {
    it('lists contain none of A’s records, even when searching for them', async () => {
      for (const path of [
        '/products?search=secret',
        '/categories?search=secret',
        '/suppliers?search=secret',
        '/warehouses?search=headquarters',
        '/products?sku=A-SECRET',
      ]) {
        const response = await t.http().get(`/api/v1${path}`).set(b.auth).expect(200);
        expect(response.body.total, path).toBe(0);
      }
    });

    it('direct reads by id are 404, indistinguishable from ids that do not exist', async () => {
      for (const path of [
        `/products/${ids.product}`,
        `/products/${ids.product}/variants`,
        `/products/${ids.product}/images`,
        `/categories/${ids.category}`,
        `/suppliers/${ids.supplier}`,
        `/warehouses/${ids.warehouse}`,
      ]) {
        const response = await t.http().get(`/api/v1${path}`).set(b.auth).expect(404);
        expect(response.body.error.code, path).toBe('NOT_FOUND');
      }
    });

    it('filtering a list by A’s ids returns nothing rather than A’s data', async () => {
      const bySupplier = await t
        .http()
        .get(`/api/v1/products?supplierId=${ids.supplier}`)
        .set(b.auth)
        .expect(200);
      expect(bySupplier.body.total).toBe(0);
      await t.http().get(`/api/v1/suppliers/${ids.supplier}/products`).set(b.auth).expect(404);
    });
  });

  describe('organization B cannot change organization A', () => {
    it('updates and deletes are 404 and leave A’s records untouched', async () => {
      await t
        .http()
        .patch(`/api/v1/products/${ids.product}`)
        .set(b.auth)
        .send({ name: 'Hijacked' })
        .expect(404);
      await t
        .http()
        .patch(`/api/v1/products/${ids.product}/variants/${ids.variant}`)
        .set(b.auth)
        .send({ name: 'Hijacked' })
        .expect(404);
      await t
        .http()
        .patch(`/api/v1/categories/${ids.category}`)
        .set(b.auth)
        .send({ name: 'Hijacked' })
        .expect(404);
      await t
        .http()
        .patch(`/api/v1/suppliers/${ids.supplier}`)
        .set(b.auth)
        .send({ companyName: 'Hijacked' })
        .expect(404);
      await t
        .http()
        .patch(`/api/v1/warehouses/${ids.warehouse}`)
        .set(b.auth)
        .send({ name: 'Hijacked' })
        .expect(404);
      await t.http().delete(`/api/v1/products/${ids.product}`).set(b.auth).expect(404);
      await t
        .http()
        .delete(`/api/v1/products/${ids.product}/variants/${ids.variant}`)
        .set(b.auth)
        .expect(404);
      await t.http().delete(`/api/v1/categories/${ids.category}`).set(b.auth).expect(404);
      await t.http().delete(`/api/v1/suppliers/${ids.supplier}`).set(b.auth).expect(404);
      await t.http().delete(`/api/v1/warehouses/${ids.warehouse}`).set(b.auth).expect(404);

      const product = (
        await t.http().get(`/api/v1/products/${ids.product}`).set(a.auth).expect(200)
      ).body;
      expect(product).toMatchObject({ name: 'A Secret Product', status: 'DRAFT' });
      expect(
        (await t.http().get(`/api/v1/categories/${ids.category}`).set(a.auth).expect(200)).body
          .name,
      ).toBe('A Secret Category');
      expect(
        (await t.http().get(`/api/v1/suppliers/${ids.supplier}`).set(a.auth).expect(200)).body
          .status,
      ).toBe('ACTIVE');
      expect(
        (await t.http().get(`/api/v1/warehouses/${ids.warehouse}`).set(a.auth).expect(200)).body
          .status,
      ).toBe('ACTIVE');
    });

    it('cannot add variants to A’s product', async () => {
      await t
        .http()
        .post(`/api/v1/products/${ids.product}/variants`)
        .set(b.auth)
        .send({ sku: 'B-INJECT', name: 'Injected' })
        .expect(404);
      const variants = (
        await t.http().get(`/api/v1/products/${ids.product}/variants`).set(a.auth).expect(200)
      ).body.items;
      expect(variants.map((v: { sku: string }) => v.sku)).toEqual(['A-SECRET']);
    });

    it('bulk status skips A’s products as not found', async () => {
      const response = await t
        .http()
        .post('/api/v1/products/bulk-status')
        .set(b.auth)
        .send({ productIds: [ids.product], status: 'ARCHIVED' })
        .expect(200);
      expect(response.body.updated).toEqual([]);
      expect(
        (await t.http().get(`/api/v1/products/${ids.product}`).set(a.auth).expect(200)).body.status,
      ).toBe('DRAFT');
    });
  });

  describe('organization B cannot reference organization A', () => {
    it('rejects A’s category and supplier on B’s products, on create and on update', async () => {
      const withCategory = await t
        .http()
        .post('/api/v1/products')
        .set(b.auth)
        .send({ name: 'B', basePrice: 1, currency: 'USD', categoryId: ids.category })
        .expect(400);
      expect(withCategory.body.error.details[0].path).toBe('categoryId');
      const withSupplier = await t
        .http()
        .post('/api/v1/products')
        .set(b.auth)
        .send({ name: 'B', basePrice: 1, currency: 'USD', supplierId: ids.supplier })
        .expect(400);
      expect(withSupplier.body.error.details[0].path).toBe('supplierId');

      const own = (
        await t
          .http()
          .post('/api/v1/products')
          .set(b.auth)
          .send({ name: 'B Own', basePrice: 1, currency: 'USD' })
          .expect(201)
      ).body;
      await t
        .http()
        .patch(`/api/v1/products/${own.id}`)
        .set(b.auth)
        .send({ categoryId: ids.category })
        .expect(400);
      await t
        .http()
        .patch(`/api/v1/products/${own.id}`)
        .set(b.auth)
        .send({ supplierId: ids.supplier })
        .expect(400);
    });

    it('rejects A’s category as the parent of B’s category', async () => {
      const response = await t
        .http()
        .post('/api/v1/categories')
        .set(b.auth)
        .send({ name: 'B Child', parentId: ids.category })
        .expect(400);
      expect(response.body.error.details[0].path).toBe('parentId');
    });

    it('ignores an organizationId smuggled into the request body or query', async () => {
      const created = await t
        .http()
        .post('/api/v1/categories')
        .set(b.auth)
        .send({ name: 'Smuggled', organizationId: a.organizationId })
        .expect(201);
      const { rows } = await t.db.query('select organization_id from categories where id = $1', [
        created.body.id,
      ]);
      expect(rows[0].organization_id).toBe(b.organizationId);
      await t.http().get(`/api/v1/categories/${created.body.id}`).set(a.auth).expect(404);

      const listed = await t
        .http()
        .get(`/api/v1/products?organizationId=${a.organizationId}`)
        .set(b.auth)
        .expect(200);
      expect(listed.body.items.map((p: { id: string }) => p.id)).not.toContain(ids.product);
    });
  });

  describe('authentication', () => {
    it('rejects missing, malformed, foreign-signed and expired tokens with 401', async () => {
      await t.http().get('/api/v1/products').expect(401);
      await t.http().get('/api/v1/products').set('Authorization', 'Bearer not-a-jwt').expect(401);
      const forged = await t.issuer.sign(
        {
          userId: a.userId,
          sessionId: crypto.randomUUID(),
          organizationId: a.organizationId,
          role: 'OWNER',
          permissions: ['products.read'],
        },
        { key: 'untrusted' },
      );
      await t.http().get('/api/v1/products').set('Authorization', `Bearer ${forged}`).expect(401);
      const expired = await t.issuer.sign(
        {
          userId: a.userId,
          sessionId: crypto.randomUUID(),
          organizationId: a.organizationId,
          role: 'OWNER',
          permissions: ['products.read'],
        },
        { expiresInSeconds: -60 },
      );
      await t.http().get('/api/v1/products').set('Authorization', `Bearer ${expired}`).expect(401);
    });

    it('requires an organization in the token for tenant data', async () => {
      const noOrg = await t.issuer.sign({ userId: a.userId, sessionId: crypto.randomUUID() });
      await t.http().get('/api/v1/products').set('Authorization', `Bearer ${noOrg}`).expect(403);
    });
  });

  describe('permissions', () => {
    let viewer: Actor;
    let staff: Actor;

    beforeAll(async () => {
      viewer = await t.actor(a.organizationId, 'VIEWER');
      staff = await t.actor(a.organizationId, 'STAFF');
    });

    it('lets read-only roles read the catalog', async () => {
      for (const actor of [viewer, staff]) {
        await t.http().get('/api/v1/products').set(actor.auth).expect(200);
        await t.http().get(`/api/v1/products/${ids.product}`).set(actor.auth).expect(200);
        await t.http().get('/api/v1/categories').set(actor.auth).expect(200);
        await t.http().get('/api/v1/suppliers').set(actor.auth).expect(200);
        await t.http().get('/api/v1/warehouses').set(actor.auth).expect(200);
      }
    });

    it('forbids catalog writes to viewers and staff, before touching data', async () => {
      const writes: Array<[string, string, object?]> = [
        ['post', '/products', { name: 'Nope', basePrice: 1, currency: 'USD' }],
        ['patch', `/products/${ids.product}`, { name: 'Nope' }],
        ['delete', `/products/${ids.product}`],
        ['post', '/products/bulk-status', { productIds: [ids.product], status: 'ARCHIVED' }],
        ['post', `/products/${ids.product}/variants`, { sku: 'NOPE', name: 'Nope' }],
        ['delete', `/products/${ids.product}/variants/${ids.variant}`],
        ['post', '/categories', { name: 'Nope' }],
        ['delete', `/categories/${ids.category}`],
        ['post', '/suppliers', { companyName: 'Nope' }],
        ['patch', `/suppliers/${ids.supplier}`, { companyName: 'Nope' }],
        ['post', '/warehouses', { code: 'NOPE', name: 'Nope' }],
        ['delete', `/warehouses/${ids.warehouse}`],
      ];
      for (const actor of [viewer, staff]) {
        for (const [method, path, body] of writes) {
          const call = t.http()[method as 'post'](`/api/v1${path}`).set(actor.auth);
          const response = await (body ? call.send(body) : call);
          expect(response.status, `${method.toUpperCase()} ${path}`).toBe(403);
        }
      }
      expect(
        (await t.http().get(`/api/v1/products/${ids.product}`).set(a.auth).expect(200)).body.name,
      ).toBe('A Secret Product');
    });

    it('does not trust permissions a token does not carry, whatever its role claim says', async () => {
      const token = await t.issuer.sign({
        userId: a.userId,
        sessionId: crypto.randomUUID(),
        organizationId: a.organizationId,
        role: 'OWNER',
        permissions: ['products.read'],
      });
      await t
        .http()
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Nope' })
        .expect(403);
    });
  });

  describe('invalid identifiers', () => {
    it('rejects malformed ids with 400 instead of querying', async () => {
      for (const path of [
        '/products/123',
        '/products/not-a-uuid/variants',
        '/categories/%27%20or%201=1',
        '/suppliers/abc',
        '/warehouses/xyz',
      ]) {
        const response = await t.http().get(`/api/v1${path}`).set(a.auth).expect(400);
        expect(response.body.error.code, path).toBe('VALIDATION_FAILED');
      }
    });
  });
});
