CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "categories_org_slug_key" UNIQUE("organization_id","slug"),
	CONSTRAINT "categories_status_check" CHECK ("categories"."status" in ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "categories_not_own_parent_check" CHECK ("categories"."parent_id" is distinct from "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "member_directory" (
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_directory_organization_id_member_id_pk" PRIMARY KEY("organization_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"correlation_id" text NOT NULL,
	"causation_id" uuid,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "product_images_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "product_images_content_type_check" CHECK ("product_images"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "product_images_size_check" CHECK ("product_images"."file_size" between 1 and 5242880),
	CONSTRAINT "product_images_key_prefix_check" CHECK ("product_images"."object_key" like ('organizations/' || "product_images"."organization_id"::text || '/products/' || "product_images"."product_id"::text || '/%'))
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_minor" bigint,
	"cost_minor" bigint,
	"weight_grams" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "product_variants_status_check" CHECK ("product_variants"."status" in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
	CONSTRAINT "product_variants_sku_normalised_check" CHECK ("product_variants"."sku" = upper(btrim("product_variants"."sku")) and "product_variants"."sku" <> ''),
	CONSTRAINT "product_variants_money_check" CHECK (coalesce("product_variants"."price_minor", 0) >= 0 and coalesce("product_variants"."cost_minor", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"category_id" uuid,
	"supplier_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"brand" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"base_cost_minor" bigint,
	"base_price_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"tax_category" text DEFAULT 'STANDARD' NOT NULL,
	"weight_grams" integer,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "products_org_slug_key" UNIQUE("organization_id","slug"),
	CONSTRAINT "products_status_check" CHECK ("products"."status" in ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
	CONSTRAINT "products_tax_category_check" CHECK ("products"."tax_category" in ('STANDARD', 'REDUCED', 'ZERO', 'EXEMPT')),
	CONSTRAINT "products_currency_check" CHECK ("products"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "products_money_check" CHECK ("products"."base_price_minor" >= 0 and ("products"."base_cost_minor" is null or "products"."base_cost_minor" >= 0)),
	CONSTRAINT "products_dimensions_check" CHECK (coalesce("products"."weight_grams", 0) >= 0 and coalesce("products"."length_mm", 0) >= 0
          and coalesce("products"."width_mm", 0) >= 0 and coalesce("products"."height_mm", 0) >= 0),
	CONSTRAINT "products_archived_at_check" CHECK (("products"."status" = 'ARCHIVED') = ("products"."archived_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"address_line" text,
	"city" text,
	"country" text,
	"payment_terms" text DEFAULT 'NET_30' NOT NULL,
	"lead_time_days" integer DEFAULT 14 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "suppliers_status_check" CHECK ("suppliers"."status" in ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "suppliers_payment_terms_check" CHECK ("suppliers"."payment_terms" in ('PREPAID', 'COD', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'NET_90')),
	CONSTRAINT "suppliers_lead_time_check" CHECK ("suppliers"."lead_time_days" between 0 and 365),
	CONSTRAINT "suppliers_country_check" CHECK ("suppliers"."country" is null or "suppliers"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"address_line" text,
	"city" text,
	"country" text,
	"manager_member_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "warehouses_org_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "warehouses_status_check" CHECK ("warehouses"."status" in ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "warehouses_code_check" CHECK ("warehouses"."code" ~ '^[A-Z0-9][A-Z0-9-]{1,19}$'),
	CONSTRAINT "warehouses_country_check" CHECK ("warehouses"."country" is null or "warehouses"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("organization_id","parent_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_org_parent_idx" ON "categories" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("occurred_at") WHERE "outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "product_images_org_product_idx" ON "product_images" USING btree ("organization_id","product_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_org_sku_live_key" ON "product_variants" USING btree ("organization_id","sku") WHERE "product_variants"."status" <> 'ARCHIVED';--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_org_barcode_live_key" ON "product_variants" USING btree ("organization_id","barcode") WHERE "product_variants"."barcode" is not null and "product_variants"."status" <> 'ARCHIVED';--> statement-breakpoint
CREATE INDEX "product_variants_org_product_idx" ON "product_variants" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX "products_org_status_updated_idx" ON "products" USING btree ("organization_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_org_updated_idx" ON "products" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "products_org_created_idx" ON "products" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "products_org_category_idx" ON "products" USING btree ("organization_id","category_id");--> statement-breakpoint
CREATE INDEX "products_org_supplier_idx" ON "products" USING btree ("organization_id","supplier_id");--> statement-breakpoint
CREATE INDEX "products_org_price_idx" ON "products" USING btree ("organization_id","base_price_minor");--> statement-breakpoint
CREATE INDEX "products_org_brand_idx" ON "products" USING btree ("organization_id",lower("brand"));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_company_name_key" ON "suppliers" USING btree ("organization_id",lower("company_name"));--> statement-breakpoint
CREATE INDEX "suppliers_org_status_idx" ON "suppliers" USING btree ("organization_id","status");