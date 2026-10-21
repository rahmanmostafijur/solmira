-- Tenant context and Row Level Security for delivery attempts (ADR-0012). A missing tenant context
-- matches nothing. processed_events holds event ids only and is written by the consumer, which
-- sets the tenant from the event it processes.
CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE delivery_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY delivery_attempts_tenant ON delivery_attempts FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
-- Attempts older than the retention period are removed across tenants by a maintenance job, which
-- has no tenant context and so cannot see these rows through RLS. The function deletes only old
-- rows, in bounded batches, and does nothing else.
CREATE FUNCTION purge_old_delivery_attempts(p_retention_days integer, p_batch integer)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH old AS (
    SELECT ctid FROM delivery_attempts
     WHERE started_at < now() - make_interval(days => p_retention_days) LIMIT p_batch
  ), removed AS (
    DELETE FROM delivery_attempts WHERE ctid IN (SELECT ctid FROM old) RETURNING 1
  )
  SELECT count(*)::integer FROM removed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_old_delivery_attempts(integer, integer) FROM PUBLIC;
