-- Tenant context, Row Level Security and immutability for the audit trail (ADR-0012, ADR-0036).
-- A missing tenant context matches nothing.
CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_logs_tenant ON audit_logs FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
-- The audit trail is append-only. Nobody updates a record, and only the schema owner may remove
-- records: the retention function below runs as the owner, the runtime role never does. The check
-- is on the role, not on a setting, so a caller cannot switch it off.
CREATE FUNCTION audit_logs_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '42501';
  END IF;
  IF current_user <> (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_logs') THEN
    RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();
--> statement-breakpoint
-- Records older than the retention period are removed across tenants by a maintenance job, which
-- has no tenant context and so cannot see these rows through RLS. The function removes only old
-- rows, in bounded batches, and does nothing else.
CREATE FUNCTION purge_old_audit_logs(p_retention_days integer, p_batch integer)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH old AS (
    SELECT ctid FROM audit_logs
     WHERE occurred_at < now() - make_interval(days => p_retention_days) LIMIT p_batch
  ), removed AS (
    DELETE FROM audit_logs WHERE ctid IN (SELECT ctid FROM old) RETURNING 1
  )
  SELECT count(*)::integer FROM removed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_old_audit_logs(integer, integer) FROM PUBLIC;
