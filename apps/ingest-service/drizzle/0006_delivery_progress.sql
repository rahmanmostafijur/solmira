ALTER TABLE "deliveries" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "last_status_code" integer;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "last_error_class" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "completed_at" timestamp with time zone;