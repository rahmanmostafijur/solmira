import { assertRowLevelSecurityEnforced } from '@solmira/service-kit';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';

/**
 * Database-level guarantees, tested in SQL without the application: what happens when code is
 * wrong. RLS (runtime role), composite foreign keys (even the owner cannot cross tenants),
 * tenant-scoped uniqueness, and the storage-key prefix rule.
 */
const owner = new pg.Pool({ connectionString: inject('ownerDatabaseUrl'), max: 2 });
const app = new pg.Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });

const orgA = uuidv7();
const orgB = uuidv7();
const ids = {
  categoryA: uuidv7(),
  categoryB: uuidv7(),
  supplierA: uuidv7(),
  supplierB: uuidv7(),
  productA: uuidv7(),
  productB: uuidv7(),
  variantB: uuidv7(),
  imageB: uuidv7(),
  warehouseB: uuidv7(),
  memberA: uuidv7(),
  memberB: uuidv7(),
};

async function asTenant<T>(
  organizationId: string | null,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.organization_id', $1, true)`, [
      organizationId ?? '',
    ]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function seedOrganization(org: string, key: 'A' | 'B') {
  const category = key === 'A' ? ids.categoryA : ids.categoryB;
  const supplier = key === 'A' ? ids.supplierA : ids.supplierB;
  const product = key === 'A' ? ids.productA : ids.productB;
  const member = key === 'A' ? ids.memberA : ids.memberB;
  await owner.query(
    `insert into categories (id, organization_id, name, slug) values ($1, $2, 'Footwear', 'footwear')`,
    [category, org],
  );
  await owner.query(
    `insert into suppliers (id, organization_id, company_name) values ($1, $2, 'Dhaka Leather Works')`,
    [supplier, org],
  );
  await owner.query(
    `insert into products (id, organization_id, category_id, supplier_id, name, slug, base_price_minor, currency)
     values ($1, $2, $3, $4, 'Classic Running Shoe', 'classic-running-shoe', 8999, 'USD')`,
    [product, org, category, supplier],
  );
  await owner.query(
    `insert into member_directory (organization_id, member_id, user_id, full_name, email, status)
     values ($1, $2, $3, 'Rahim Uddin', $4, 'active')`,
    [org, member, uuidv7(), `rahim.${key}@example.test`],
  );
}

describe('operations database: tenant guarantees', () => {
  beforeAll(async () => {
    await seedOrganization(orgA, 'A');
    await seedOrganization(orgB, 'B');
    await owner.query(
      `insert into product_variants (id, organization_id, product_id, sku, name) values ($1, $2, $3, 'SKU-100', 'Size 42 / Black')`,
      [ids.variantB, orgB, ids.productB],
    );
    await owner.query(
      `insert into product_images (id, organization_id, product_id, object_key, original_filename, content_type, file_size, sort_order)
       values ($1, $2, $3, $4, 'shoe.jpg', 'image/jpeg', 1024, 0)`,
      [
        ids.imageB,
        orgB,
        ids.productB,
        `organizations/${orgB}/products/${ids.productB}/${uuidv7()}`,
      ],
    );
    await owner.query(
      `insert into warehouses (id, organization_id, code, name, manager_member_id) values ($1, $2, 'WH-DHK', 'Dhaka Central', $3)`,
      [ids.warehouseB, orgB, ids.memberB],
    );
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  describe('Row Level Security (runtime role)', () => {
    const tenantTables = [
      'categories',
      'suppliers',
      'products',
      'product_variants',
      'product_images',
      'warehouses',
      'member_directory',
    ];

    it('runs as a role that cannot bypass RLS', async () => {
      await expect(assertRowLevelSecurityEnforced(app)).resolves.toBeUndefined();
    });

    it.each(tenantTables)('%s: without a tenant context nothing is visible', async (table) => {
      const { rows } = await asTenant(null, (client) =>
        client.query(`select count(*)::int as n from ${table}`),
      );
      expect(rows[0].n).toBe(0);
    });

    it.each(tenantTables)("%s: organization A never sees B's rows", async (table) => {
      const { rows } = await asTenant(orgA, (client) =>
        client.query(`select count(*)::int as n from ${table} where organization_id = $1`, [orgB]),
      );
      expect(rows[0].n).toBe(0);
    });

    it("cannot update or delete B's rows even by exact id", async () => {
      const changed = await asTenant(orgA, async (client) => [
        (await client.query(`update products set name = 'Hijacked' where id = $1`, [ids.productB]))
          .rowCount,
        (
          await client.query(`update product_variants set sku = 'STOLEN' where id = $1`, [
            ids.variantB,
          ])
        ).rowCount,
        (await client.query(`delete from product_images where id = $1`, [ids.imageB])).rowCount,
        (
          await client.query(`update warehouses set status = 'INACTIVE' where id = $1`, [
            ids.warehouseB,
          ])
        ).rowCount,
        (await client.query(`delete from suppliers where id = $1`, [ids.supplierB])).rowCount,
        (await client.query(`update categories set name = 'x' where id = $1`, [ids.categoryB]))
          .rowCount,
      ]);
      expect(changed).toEqual([0, 0, 0, 0, 0, 0]);
      const { rows } = await owner.query('select name from products where id = $1', [ids.productB]);
      expect(rows[0].name).toBe('Classic Running Shoe');
    });

    it('cannot insert rows into another tenant', async () => {
      await expect(
        asTenant(orgA, (client) =>
          client.query(
            `insert into suppliers (id, organization_id, company_name) values ($1, $2, 'Planted')`,
            [uuidv7(), orgB],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('composite foreign keys (enforced even for the owner role)', () => {
    it('rejects a variant pointing at another organization’s product', async () => {
      await expect(
        owner.query(
          `insert into product_variants (id, organization_id, product_id, sku, name) values ($1, $2, $3, 'X-1', 'x')`,
          [uuidv7(), orgA, ids.productB],
        ),
      ).rejects.toMatchObject({ code: '23503', constraint: 'product_variants_product_fk' });
    });

    it('rejects a product using another organization’s category or supplier', async () => {
      const insert = (category: string | null, supplier: string | null) =>
        owner.query(
          `insert into products (id, organization_id, category_id, supplier_id, name, slug, base_price_minor, currency)
           values ($1, $2, $3, $4, 'X', $5, 100, 'USD')`,
          [uuidv7(), orgA, category, supplier, `x-${uuidv7()}`],
        );
      await expect(insert(ids.categoryB, null)).rejects.toMatchObject({
        constraint: 'products_category_fk',
      });
      await expect(insert(null, ids.supplierB)).rejects.toMatchObject({
        constraint: 'products_supplier_fk',
      });
      await expect(insert(ids.categoryA, ids.supplierA)).resolves.toBeDefined();
    });

    it('rejects a warehouse manager from another organization', async () => {
      await expect(
        owner.query(
          `insert into warehouses (id, organization_id, code, name, manager_member_id) values ($1, $2, 'WH-X1', 'X', $3)`,
          [uuidv7(), orgA, ids.memberB],
        ),
      ).rejects.toMatchObject({ code: '23503', constraint: 'warehouses_manager_fk' });
    });

    it('rejects a category parent from another organization and self-parenting', async () => {
      await expect(
        owner.query(
          `insert into categories (id, organization_id, parent_id, name, slug) values ($1, $2, $3, 'Child', 'child-x')`,
          [uuidv7(), orgA, ids.categoryB],
        ),
      ).rejects.toMatchObject({ constraint: 'categories_parent_fk' });
      await expect(
        owner.query(`update categories set parent_id = id where id = $1`, [ids.categoryA]),
      ).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('rejects an image whose storage key points into another organization', async () => {
      await expect(
        owner.query(
          `insert into product_images (id, organization_id, product_id, object_key, original_filename, content_type, file_size, sort_order)
           values ($1, $2, $3, $4, 'x.png', 'image/png', 10, 0)`,
          [
            uuidv7(),
            orgA,
            ids.productA,
            `organizations/${orgB}/products/${ids.productA}/${uuidv7()}`,
          ],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'product_images_key_prefix_check' });
    });
  });

  describe('tenant-scoped uniqueness', () => {
    it('lets two organizations use the same SKU, but not one organization twice', async () => {
      await asTenant(orgA, (client) =>
        client.query(
          `insert into product_variants (id, organization_id, product_id, sku, name) values ($1, $2, $3, 'SKU-100', 'A')`,
          [uuidv7(), orgA, ids.productA],
        ),
      );
      await expect(
        asTenant(orgA, (client) =>
          client.query(
            `insert into product_variants (id, organization_id, product_id, sku, name) values ($1, $2, $3, 'SKU-100', 'dup')`,
            [uuidv7(), orgA, ids.productA],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'product_variants_org_sku_live_key' });
    });

    it('frees an archived SKU for reuse', async () => {
      await asTenant(orgA, async (client) => {
        await client.query(
          `insert into product_variants (id, organization_id, product_id, sku, name, status) values ($1, $2, $3, 'SKU-OLD', 'old', 'ARCHIVED')`,
          [uuidv7(), orgA, ids.productA],
        );
        await client.query(
          `insert into product_variants (id, organization_id, product_id, sku, name) values ($1, $2, $3, 'SKU-OLD', 'new')`,
          [uuidv7(), orgA, ids.productA],
        );
      });
    });

    it('rejects SKUs that bypass normalisation', async () => {
      await expect(
        asTenant(orgA, (client) =>
          client.query(
            `insert into product_variants (id, organization_id, product_id, sku, name) values ($1, $2, $3, 'sku-lower', 'x')`,
            [uuidv7(), orgA, ids.productA],
          ),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('lets two organizations use the same warehouse code, but not one organization twice', async () => {
      await asTenant(orgA, (client) =>
        client.query(
          `insert into warehouses (id, organization_id, code, name) values ($1, $2, 'WH-DHK', 'Dhaka A')`,
          [uuidv7(), orgA],
        ),
      );
      await expect(
        asTenant(orgA, (client) =>
          client.query(
            `insert into warehouses (id, organization_id, code, name) values ($1, $2, 'WH-DHK', 'Dup')`,
            [uuidv7(), orgA],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'warehouses_org_code_key' });
    });
  });
});
