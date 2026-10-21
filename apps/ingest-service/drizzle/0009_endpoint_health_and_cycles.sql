ALTER TABLE "deliveries" ADD COLUMN "cycle_base" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "first_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "circuit_open_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN "circuit_trips" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "deliveries_tenant_due_idx" ON "deliveries" USING btree ("organization_id","next_attempt_at") WHERE "deliveries"."status" = 'pending';