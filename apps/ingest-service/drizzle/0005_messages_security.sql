-- Row Level Security for messages, idempotency records and deliveries, and the maintenance
-- functions that must work across tenants (ADR-0030, ADR-0029).

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY messages_tenant ON messages FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_keys_tenant ON idempotency_keys FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY deliveries_tenant ON deliveries FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- processed_events and outbox_events hold ids and event types only, and are read by background
-- work that has no tenant of its own (consumers set the tenant from the event they process).

-- Expired idempotency records are removed across tenants by a maintenance job, which has no tenant
-- context and so cannot see these rows through RLS. The function deletes only expired rows, in
-- bounded batches, and does nothing else.
CREATE FUNCTION purge_expired_idempotency_keys(p_batch integer)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH expired AS (
    SELECT ctid FROM idempotency_keys WHERE expires_at < now() LIMIT p_batch
  ), removed AS (
    DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM expired) RETURNING 1
  )
  SELECT count(*)::integer FROM removed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_expired_idempotency_keys(integer) FROM PUBLIC;
