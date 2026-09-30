-- Tenant security and receipt immutability for purchasing (see ADR-0021 and ADR-0022).
--
-- Orders, lines and the number counter get the usual FOR ALL tenant policy. Receipts are a
-- historical record, like the inventory ledger: SELECT and INSERT policies only, so the runtime
-- role cannot change or remove one, and a trigger refuses it for every other role as well.

ALTER TABLE purchase_order_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY purchase_order_counters_tenant ON purchase_order_counters FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY purchase_orders_tenant ON purchase_orders FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY purchase_order_items_tenant ON purchase_order_items FOR ALL
  USING (organization_id = app_current_organization_id())
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY purchase_receipts_tenant_read ON purchase_receipts FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY purchase_receipts_tenant_append ON purchase_receipts FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint
ALTER TABLE purchase_receipt_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY purchase_receipt_items_tenant_read ON purchase_receipt_items FOR SELECT
  USING (organization_id = app_current_organization_id());
--> statement-breakpoint
CREATE POLICY purchase_receipt_items_tenant_append ON purchase_receipt_items FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id());
--> statement-breakpoint

CREATE FUNCTION purchase_receipts_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING HINT = 'Receipts are history; correct stock with an inventory adjustment';
END
$$;
--> statement-breakpoint
CREATE TRIGGER purchase_receipts_no_update_or_delete
  BEFORE UPDATE OR DELETE ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION purchase_receipts_append_only();
--> statement-breakpoint
CREATE TRIGGER purchase_receipts_no_truncate
  BEFORE TRUNCATE ON purchase_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION purchase_receipts_append_only();
--> statement-breakpoint
CREATE TRIGGER purchase_receipt_items_no_update_or_delete
  BEFORE UPDATE OR DELETE ON purchase_receipt_items
  FOR EACH ROW EXECUTE FUNCTION purchase_receipts_append_only();
--> statement-breakpoint
CREATE TRIGGER purchase_receipt_items_no_truncate
  BEFORE TRUNCATE ON purchase_receipt_items
  FOR EACH STATEMENT EXECUTE FUNCTION purchase_receipts_append_only();
--> statement-breakpoint

-- Search by PO number fragment ("000123", "2026-0001"): trigram index, tenant column first.
CREATE INDEX purchase_orders_search_number_idx ON purchase_orders
  USING gin (organization_id, number gin_trgm_ops);
