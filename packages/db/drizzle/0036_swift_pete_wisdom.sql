CREATE TABLE "connector_callback_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"connector_id" text NOT NULL,
	"provider_id" text,
	"flow_id" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"stage" text DEFAULT 'callback' NOT NULL,
	"message" text,
	"error_code" text,
	"account_login" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "connector_callback_event_source_check" CHECK ("connector_callback_event"."source" in ('oauth', 'github_app')),
	CONSTRAINT "connector_callback_event_status_check" CHECK ("connector_callback_event"."status" in ('success', 'degraded', 'error'))
);
--> statement-breakpoint
ALTER TABLE "connector_callback_event" ADD CONSTRAINT "connector_callback_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_callback_event" ADD CONSTRAINT "connector_callback_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_callback_event_workspace_created_at_idx" ON "connector_callback_event" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "connector_callback_event_flow_idx" ON "connector_callback_event" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "connector_callback_event_connector_created_at_idx" ON "connector_callback_event" USING btree ("connector_id","created_at");