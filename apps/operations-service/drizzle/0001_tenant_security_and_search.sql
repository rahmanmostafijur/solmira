-- Tenant security and search for operational master data.
--
-- Same model as identity-service (see docs/architecture/tenant-isolation.md): the runtime role is
-- not the table owner, the tenant arrives per transaction via set_config('app.organization_id',
-- ..., true), and a missing context resolves to NULL so no tenant rows match (default deny).
-- Here every table except the outbox is tenant-owned, so every policy is the same rule.

CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
--> statement-breakpoint

ALTER TABLE member_directory ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_directory_tenant ON member_directory FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY categories_tenant ON categories FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY suppliers_tenant ON suppliers FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY warehouses_tenant ON warehouses FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY products_tenant ON products FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY product_variants_tenant ON product_variants FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY product_images_tenant ON product_images FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- Warehouse manager: must be a member of the same organization. ON DELETE SET NULL on the
-- manager column only (PostgreSQL 15+), so removing a directory entry never nulls organization_id.
ALTER TABLE warehouses ADD CONSTRAINT warehouses_manager_fk
  FOREIGN KEY (organization_id, manager_member_id)
  REFERENCES member_directory (organization_id, member_id)
  ON DELETE SET NULL (manager_member_id);
--> statement-breakpoint

-- Search. pg_trgm makes ILIKE '%term%' indexable; btree_gin lets organization_id sit in the same
-- GIN index, so a tenant's search does not scan other tenants' index entries. Both extensions are
-- "trusted", so the database owner can create them without superuser rights.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
CREATE INDEX products_search_name_idx ON products USING gin (organization_id, name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX products_search_brand_idx ON products USING gin (organization_id, brand gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX product_variants_search_sku_idx ON product_variants USING gin (organization_id, sku gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX suppliers_search_company_idx ON suppliers USING gin (organization_id, company_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX warehouses_search_name_idx ON warehouses USING gin (organization_id, name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX categories_search_name_idx ON categories USING gin (organization_id, name gin_trgm_ops);
