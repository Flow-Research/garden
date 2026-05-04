-- Custom SQL migration file, put your code below! --
ALTER TABLE "agent" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_status_check";
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_status_check" CHECK ("agent"."status" in ('active', 'pending_approval', 'archived'));
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_default_idx" ON "agent" USING btree ("workspace_id") WHERE "is_default" = true;
--> statement-breakpoint
ALTER TABLE "permission_request" ADD COLUMN "kind" text DEFAULT 'connector_write' NOT NULL;
--> statement-breakpoint
ALTER TABLE "permission_request" ADD CONSTRAINT "permission_request_kind_check" CHECK ("permission_request"."kind" in ('connector_write', 'agent_proposal'));
