CREATE TABLE "purchase_order_counters" (
	"organization_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "purchase_order_counters_organization_id_year_pk" PRIMARY KEY("organization_id","year"),
	CONSTRAINT "purchase_order_counters_value_check" CHECK ("purchase_order_counters"."last_value" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_items_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_order_items_org_order_id_key" UNIQUE("organization_id","purchase_order_id","id"),
	CONSTRAINT "purchase_order_items_org_order_variant_key" UNIQUE("organization_id","purchase_order_id","variant_id"),
	CONSTRAINT "purchase_order_items_quantity_check" CHECK ("purchase_order_items"."ordered_quantity" > 0 and "purchase_order_items"."received_quantity" >= 0
          and "purchase_order_items"."received_quantity" <= "purchase_order_items"."ordered_quantity"),
	CONSTRAINT "purchase_order_items_amounts_check" CHECK ("purchase_order_items"."unit_cost_minor" >= 0 and "purchase_order_items"."tax_rate_bps" between 0 and 10000
          and "purchase_order_items"."subtotal_minor" = "purchase_order_items"."ordered_quantity"::bigint * "purchase_order_items"."unit_cost_minor"
          and "purchase_order_items"."tax_minor" >= 0
          and "purchase_order_items"."total_minor" = "purchase_order_items"."subtotal_minor" + "purchase_order_items"."tax_minor")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"currency" text NOT NULL,
	"expected_delivery_date" date,
	"notes" text,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_orders_org_id_warehouse_key" UNIQUE("organization_id","id","warehouse_id"),
	CONSTRAINT "purchase_orders_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
	CONSTRAINT "purchase_orders_currency_check" CHECK ("purchase_orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "purchase_orders_number_check" CHECK ("purchase_orders"."number" ~ '^PO-[0-9]{4}-[0-9]{6,}$'),
	CONSTRAINT "purchase_orders_money_check" CHECK ("purchase_orders"."subtotal_minor" >= 0 and "purchase_orders"."tax_minor" >= 0 and "purchase_orders"."shipping_minor" >= 0
          and "purchase_orders"."total_minor" = "purchase_orders"."subtotal_minor" + "purchase_orders"."tax_minor" + "purchase_orders"."shipping_minor"),
	CONSTRAINT "purchase_orders_submitted_check" CHECK (case "purchase_orders"."status"
            when 'DRAFT' then "purchase_orders"."submitted_at" is null
            when 'CANCELLED' then true
            else "purchase_orders"."submitted_at" is not null and "purchase_orders"."submitted_by" is not null
          end),
	CONSTRAINT "purchase_orders_approved_check" CHECK (case
            when "purchase_orders"."status" in ('DRAFT', 'SUBMITTED') then "purchase_orders"."approved_at" is null
            when "purchase_orders"."status" = 'CANCELLED' then "purchase_orders"."approved_at" is null or "purchase_orders"."submitted_at" is not null
            else "purchase_orders"."approved_at" is not null and "purchase_orders"."approved_by" is not null
          end),
	CONSTRAINT "purchase_orders_received_check" CHECK (("purchase_orders"."status" = 'RECEIVED') = ("purchase_orders"."received_at" is not null)),
	CONSTRAINT "purchase_orders_cancelled_check" CHECK (("purchase_orders"."status" = 'CANCELLED') = ("purchase_orders"."cancelled_at" is not null)
          and ("purchase_orders"."cancelled_at" is null or "purchase_orders"."cancellation_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"inventory_movement_id" uuid NOT NULL,
	CONSTRAINT "purchase_receipt_items_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_receipt_items_receipt_line_key" UNIQUE("organization_id","receipt_id","purchase_order_item_id"),
	CONSTRAINT "purchase_receipt_items_movement_key" UNIQUE("inventory_movement_id"),
	CONSTRAINT "purchase_receipt_items_quantity_check" CHECK ("purchase_receipt_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	CONSTRAINT "purchase_receipts_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_receipts_org_id_order_key" UNIQUE("organization_id","id","purchase_order_id"),
	CONSTRAINT "purchase_receipts_org_idempotency_key" UNIQUE("organization_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_change_check";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_org_product_id_key" UNIQUE("organization_id","product_id","id");--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_fk" FOREIGN KEY ("organization_id","product_id","variant_id") REFERENCES "public"."product_variants"("organization_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receipt_fk" FOREIGN KEY ("organization_id","receipt_id","purchase_order_id") REFERENCES "public"."purchase_receipts"("organization_id","id","purchase_order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_line_fk" FOREIGN KEY ("organization_id","purchase_order_id","purchase_order_item_id") REFERENCES "public"."purchase_order_items"("organization_id","purchase_order_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_movement_fk" FOREIGN KEY ("organization_id","inventory_movement_id") REFERENCES "public"."inventory_movements"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_order_fk" FOREIGN KEY ("organization_id","purchase_order_id","warehouse_id") REFERENCES "public"."purchase_orders"("organization_id","id","warehouse_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_items_org_variant_idx" ON "purchase_order_items" USING btree ("organization_id","variant_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_org_created_idx" ON "purchase_orders" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_orders_org_status_created_idx" ON "purchase_orders" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_orders_org_supplier_created_idx" ON "purchase_orders" USING btree ("organization_id","supplier_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_orders_org_warehouse_created_idx" ON "purchase_orders" USING btree ("organization_id","warehouse_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_receipt_items_org_line_idx" ON "purchase_receipt_items" USING btree ("organization_id","purchase_order_item_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_org_order_received_idx" ON "purchase_receipts" USING btree ("organization_id","purchase_order_id","received_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_check" CHECK ("inventory_movements"."type" in ('ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RESERVATION', 'RELEASE', 'PURCHASE_RECEIPT'));--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_change_check" CHECK (case "inventory_movements"."type"
            when 'ADJUSTMENT' then "inventory_movements"."on_hand_change" <> 0 and "inventory_movements"."reserved_change" = 0
            when 'TRANSFER_OUT' then "inventory_movements"."on_hand_change" < 0 and "inventory_movements"."reserved_change" = 0
            when 'TRANSFER_IN' then "inventory_movements"."on_hand_change" > 0 and "inventory_movements"."reserved_change" = 0
            when 'RESERVATION' then "inventory_movements"."on_hand_change" = 0 and "inventory_movements"."reserved_change" > 0
            when 'RELEASE' then "inventory_movements"."on_hand_change" = 0 and "inventory_movements"."reserved_change" < 0
            when 'PURCHASE_RECEIPT' then "inventory_movements"."on_hand_change" > 0 and "inventory_movements"."reserved_change" = 0
          end);