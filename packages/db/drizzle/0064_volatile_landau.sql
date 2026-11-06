CREATE TABLE "github_webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"binding_id" uuid NOT NULL,
	"event" text NOT NULL,
	"action" text NOT NULL,
	"order_scope" text NOT NULL,
	"order_marker" bigint NOT NULL,
	"status" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_webhook_delivery_status_check" CHECK ("github_webhook_delivery"."status" in ('applied', 'stale'))
);
--> statement-breakpoint
ALTER TABLE "issue_comment" DROP CONSTRAINT "issue_comment_author_type_check";--> statement-breakpoint
ALTER TABLE "issue_comment" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "external_comment_id" text;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "github_webhook_delivery" ADD CONSTRAINT "github_webhook_delivery_binding_id_issue_source_binding_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."issue_source_binding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_webhook_delivery_id_unique" ON "github_webhook_delivery" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "github_webhook_delivery_order_scope_marker_idx" ON "github_webhook_delivery" USING btree ("order_scope","order_marker");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_comment_external_comment_unique" ON "issue_comment" USING btree ("issue_id","external_comment_id") WHERE "issue_comment"."external_comment_id" is not null;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_author_id_check" CHECK (("issue_comment"."author_type" = 'connector' and "issue_comment"."author_id" is null) or ("issue_comment"."author_type" in ('user', 'agent') and "issue_comment"."author_id" is not null));--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_author_type_check" CHECK ("issue_comment"."author_type" in ('user', 'agent', 'connector'));