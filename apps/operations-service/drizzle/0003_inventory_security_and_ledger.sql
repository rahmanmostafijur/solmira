-- Tenant security and ledger guarantees for inventory (see ADR-0018 and ADR-0019).
--
-- Levels and reservations get the usual FOR ALL tenant policy. The ledger gets SELECT and INSERT
-- policies only: with Row Level Security enabled and no UPDATE or DELETE policy, the runtime role
-- can never change or remove a movement, and a trigger refuses it for every other role as well.

ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_levels_tenant ON inventory_levels FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_reservations_tenant ON inventory_reservations FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inventory_movements_tenant_read ON inventory_movements FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY inventory_movements_tenant_append ON inventory_movements FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

-- Append-only, for the table owner too. A correction is a new, compensating movement.
CREATE FUNCTION inventory_movements_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements is append-only: % is not allowed', TG_OP
    USING HINT = 'Record a compensating movement instead';
END
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_movements_no_update_or_delete
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION inventory_movements_append_only();
--> statement-breakpoint
CREATE TRIGGER inventory_movements_no_truncate
  BEFORE TRUNCATE ON inventory_movements
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_movements_append_only();
--> statement-breakpoint

-- "Low stock" list: only levels at or under their reorder point are indexed, so the filter stays
-- cheap however many healthy levels an organization has.
CREATE INDEX inventory_levels_org_low_stock_idx ON inventory_levels (organization_id, available)
  WHERE reorder_point IS NOT NULL AND available <= reorder_point;
