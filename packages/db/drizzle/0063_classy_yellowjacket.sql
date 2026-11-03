CREATE TABLE "github_webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"installation_id" text,
	"order_scope" text NOT NULL,
	"order_marker" bigint NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"binding_id" uuid,
	"workspace_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_webhook_delivery_status_check" CHECK ("github_webhook_delivery"."status" in ('applied', 'duplicate', 'out_of_order', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "github_webhook_delivery" ADD CONSTRAINT "github_webhook_delivery_binding_id_issue_source_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."issue_source_binding"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_webhook_delivery" ADD CONSTRAINT "github_webhook_delivery_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_webhook_delivery_id_unique" ON "github_webhook_delivery" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "github_webhook_delivery_order_scope_marker_idx" ON "github_webhook_delivery" USING btree ("order_scope","order_marker");