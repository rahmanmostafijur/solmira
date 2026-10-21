-- Tenant context and Row Level Security for notifications (ADR-0012). A missing tenant context
-- matches nothing. processed_events holds event ids only and is written by the consumer, which
-- sets the tenant from the event it processes.
CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_tenant ON notifications FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
