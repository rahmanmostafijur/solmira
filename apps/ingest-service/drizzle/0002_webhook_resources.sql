CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_scopes_not_empty" CHECK (cardinality("api_keys"."scopes") > 0)
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "applications_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "endpoint_event_types" (
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	CONSTRAINT "endpoint_event_types_endpoint_id_event_type_id_pk" PRIMARY KEY("endpoint_id","event_type_id")
);
--> statement-breakpoint
CREATE TABLE "endpoint_secrets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "endpoint_secrets_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "endpoint_secrets_status" CHECK ("endpoint_secrets"."status" in ('active', 'previous'))
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"disabled_at" timestamp with time zone,
	"rate_limit_per_second" integer,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "endpoints_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "endpoints_rate_limit_range" CHECK ("endpoints"."rate_limit_per_second" is null or "endpoints"."rate_limit_per_second" between 1 and 1000),
	CONSTRAINT "endpoints_url_length" CHECK (char_length("endpoints"."url") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schema" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "event_types_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "event_types_org_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "event_types_name_format" CHECK ("event_types"."name" ~ '^[a-z0-9][a-z0-9_.-]{0,127}$')
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."applications"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_event_types" ADD CONSTRAINT "endpoint_event_types_endpoint_fk" FOREIGN KEY ("organization_id","endpoint_id") REFERENCES "public"."endpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_event_types" ADD CONSTRAINT "endpoint_event_types_event_type_fk" FOREIGN KEY ("organization_id","event_type_id") REFERENCES "public"."event_types"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoint_secrets" ADD CONSTRAINT "endpoint_secrets_endpoint_fk" FOREIGN KEY ("organization_id","endpoint_id") REFERENCES "public"."endpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_application_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "public"."applications"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_application_idx" ON "api_keys" USING btree ("organization_id","application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_org_name_live_idx" ON "applications" USING btree ("organization_id",lower("name")) WHERE "applications"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "endpoint_event_types_event_type_idx" ON "endpoint_event_types" USING btree ("organization_id","event_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "endpoint_secrets_one_active_idx" ON "endpoint_secrets" USING btree ("endpoint_id") WHERE "endpoint_secrets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "endpoints_application_idx" ON "endpoints" USING btree ("organization_id","application_id");