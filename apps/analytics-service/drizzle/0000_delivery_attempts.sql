CREATE TABLE "delivery_attempts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"result" text NOT NULL,
	"status_code" integer,
	"error_class" text,
	"duration_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "delivery_attempts_attempt_key" UNIQUE("organization_id","delivery_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE INDEX "delivery_attempts_application_idx" ON "delivery_attempts" USING btree ("organization_id","application_id","started_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_endpoint_idx" ON "delivery_attempts" USING btree ("organization_id","endpoint_id","started_at");--> statement-breakpoint
CREATE INDEX "delivery_attempts_started_idx" ON "delivery_attempts" USING btree ("started_at");