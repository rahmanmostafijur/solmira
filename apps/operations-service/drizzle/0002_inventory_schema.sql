CREATE TABLE "inventory_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"available" integer GENERATED ALWAYS AS (on_hand - reserved) STORED,
	"reorder_point" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_levels_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_levels_org_warehouse_variant_key" UNIQUE("organization_id","warehouse_id","variant_id"),
	CONSTRAINT "inventory_levels_quantities_check" CHECK ("inventory_levels"."on_hand" >= 0 and "inventory_levels"."reserved" >= 0 and "inventory_levels"."reserved" <= "inventory_levels"."on_hand"
          and "inventory_levels"."on_hand" <= 1000000000),
	CONSTRAINT "inventory_levels_reorder_point_check" CHECK ("inventory_levels"."reorder_point" is null or "inventory_levels"."reorder_point" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "inventory_movements_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"inventory_level_id" uuid NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"on_hand_change" integer NOT NULL,
	"reserved_change" integer NOT NULL,
	"on_hand_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"note" text,
	"actor_id" uuid,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "inventory_movements_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_movements_sequence_key" UNIQUE("sequence"),
	CONSTRAINT "inventory_movements_type_check" CHECK ("inventory_movements"."type" in ('ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RESERVATION', 'RELEASE')),
	CONSTRAINT "inventory_movements_reason_check" CHECK (("inventory_movements"."type" = 'ADJUSTMENT') = ("inventory_movements"."reason" is not null)
          and ("inventory_movements"."reason" is null or "inventory_movements"."reason" in ('RECEIVED', 'COUNT', 'DAMAGED', 'LOST', 'FOUND', 'RETURNED', 'CORRECTION'))),
	CONSTRAINT "inventory_movements_change_check" CHECK (case "inventory_movements"."type"
            when 'ADJUSTMENT' then "inventory_movements"."on_hand_change" <> 0 and "inventory_movements"."reserved_change" = 0
            when 'TRANSFER_OUT' then "inventory_movements"."on_hand_change" < 0 and "inventory_movements"."reserved_change" = 0
            when 'TRANSFER_IN' then "inventory_movements"."on_hand_change" > 0 and "inventory_movements"."reserved_change" = 0
            when 'RESERVATION' then "inventory_movements"."on_hand_change" = 0 and "inventory_movements"."reserved_change" > 0
            when 'RELEASE' then "inventory_movements"."on_hand_change" = 0 and "inventory_movements"."reserved_change" < 0
          end),
	CONSTRAINT "inventory_movements_balance_check" CHECK ("inventory_movements"."on_hand_after" >= 0 and "inventory_movements"."reserved_after" >= 0 and "inventory_movements"."reserved_after" <= "inventory_movements"."on_hand_after"),
	CONSTRAINT "inventory_movements_reference_check" CHECK (("inventory_movements"."reference_type" is null) = ("inventory_movements"."reference_id" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_level_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"reference" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_reservations_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_reservations_status_check" CHECK ("inventory_reservations"."status" in ('ACTIVE', 'RELEASED')),
	CONSTRAINT "inventory_reservations_quantity_check" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_released_check" CHECK (("inventory_reservations"."status" = 'RELEASED') = ("inventory_reservations"."released_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_warehouse_fk" FOREIGN KEY ("organization_id","warehouse_id") REFERENCES "public"."warehouses"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_level_fk" FOREIGN KEY ("organization_id","inventory_level_id") REFERENCES "public"."inventory_levels"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_level_fk" FOREIGN KEY ("organization_id","inventory_level_id") REFERENCES "public"."inventory_levels"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_levels_org_variant_idx" ON "inventory_levels" USING btree ("organization_id","variant_id");--> statement-breakpoint
CREATE INDEX "inventory_levels_org_updated_idx" ON "inventory_levels" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_movements_org_level_sequence_idx" ON "inventory_movements" USING btree ("organization_id","inventory_level_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_movements_org_sequence_idx" ON "inventory_movements" USING btree ("organization_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_movements_org_created_idx" ON "inventory_movements" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_reference_idx" ON "inventory_movements" USING btree ("organization_id","reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_org_status_created_idx" ON "inventory_reservations" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_reservations_org_level_idx" ON "inventory_reservations" USING btree ("organization_id","inventory_level_id");