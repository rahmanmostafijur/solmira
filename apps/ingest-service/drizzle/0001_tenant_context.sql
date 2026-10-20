-- Tenant context for Row Level Security (see docs/architecture/tenant-isolation.md).
--
-- The runtime role is not the table owner and the tenant arrives per transaction through
-- set_config('app.organization_id', ..., true). A missing context resolves to NULL, so no tenant
-- row matches (default deny). Every tenant-owned table added later enables RLS with a policy
-- that compares organization_id to this function. The outbox is not tenant-scoped: the relay
-- reads it across tenants.
CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
