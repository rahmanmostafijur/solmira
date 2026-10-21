CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"details" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_event_key" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE INDEX "audit_logs_org_time_idx" ON "audit_logs" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_org_action_idx" ON "audit_logs" USING btree ("organization_id","action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_org_target_idx" ON "audit_logs" USING btree ("organization_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_actor_idx" ON "audit_logs" USING btree ("organization_id","actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("occurred_at");