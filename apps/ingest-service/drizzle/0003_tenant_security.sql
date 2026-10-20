-- Row Level Security for the webhook resources (ADR-0012, docs/architecture/tenant-isolation.md).
--
-- Every table is tenant-owned: one policy per table, the same rule for reads and writes, and a
-- missing tenant context matches nothing. The runtime role does not own the tables, so the
-- policies apply to it; the owner role (migrations) is the only one that bypasses them.

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY applications_tenant ON applications FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY event_types_tenant ON event_types FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE endpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY endpoints_tenant ON endpoints FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE endpoint_event_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY endpoint_event_types_tenant ON endpoint_event_types FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE endpoint_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY endpoint_secrets_tenant ON endpoint_secrets FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_keys_tenant ON api_keys FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- API key authentication (ADR-0027). The caller of an ingestion request is not yet known to belong
-- to any tenant, so the key digest is looked up here, by the one function that reads api_keys
-- without a tenant. It runs with the owner's rights, has a fixed search_path, answers only for an
-- active key of a live application, and records the last use at most once a minute per key.
CREATE FUNCTION authenticate_api_key(p_key_hash text)
RETURNS TABLE (api_key_id uuid, organization_id uuid, application_id uuid, scopes text[])
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH hit AS (
    SELECT k.id, k.organization_id, k.application_id, k.scopes
      FROM api_keys k
      JOIN applications a ON a.organization_id = k.organization_id AND a.id = k.application_id
     WHERE k.key_hash = p_key_hash
       AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > now())
       AND a.archived_at IS NULL
  ), touched AS (
    UPDATE api_keys
       SET last_used_at = now()
      FROM hit
     WHERE api_keys.id = hit.id
       AND (api_keys.last_used_at IS NULL OR api_keys.last_used_at < now() - interval '1 minute')
  )
  SELECT id, organization_id, application_id, scopes FROM hit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION authenticate_api_key(text) FROM PUBLIC;
