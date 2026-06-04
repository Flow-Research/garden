ALTER TABLE "issue_run" DROP CONSTRAINT "issue_run_trigger_source_check";--> statement-breakpoint
ALTER TABLE "issue_wakeup" DROP CONSTRAINT "issue_wakeup_source_check";--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_status_check";--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_issue_id_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_issue_run_id_issue_run_id_fk";
--> statement-breakpoint
DROP INDEX "automation_run_issue_idx";--> statement-breakpoint
ALTER TABLE "issue_run" ALTER COLUMN "issue_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "agent_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "host_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "workflow_instance_id" text;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "context_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "result_json" jsonb;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "usage_json" jsonb;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_run_workspace_idx" ON "automation_run" USING btree ("workspace_id","status","triggered_at");--> statement-breakpoint
CREATE INDEX "automation_run_agent_active_idx" ON "automation_run" USING btree ("agent_id") WHERE "automation_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "automation_run_workflow_idx" ON "automation_run" USING btree ("workflow_instance_id") WHERE "automation_run"."workflow_instance_id" is not null;--> statement-breakpoint
ALTER TABLE "automation" DROP COLUMN "issue_title_template";--> statement-breakpoint
ALTER TABLE "automation_run" DROP COLUMN "issue_id";--> statement-breakpoint
ALTER TABLE "automation_run" DROP COLUMN "issue_run_id";--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_trigger_source_check" CHECK ("issue_run"."trigger_source" is null or "issue_run"."trigger_source" in ('schedule', 'manual', 'webhook', 'api', 'chat', 'sub_agent', 'comment', 'mention', 'assignment', 'connector_event', 'reconciler_retry', 'hire_approval'));--> statement-breakpoint
ALTER TABLE "issue_wakeup" ADD CONSTRAINT "issue_wakeup_source_check" CHECK ("issue_wakeup"."source" in ('assignment', 'comment', 'mention', 'manual', 'scheduled', 'connector_event', 'reconciler_retry', 'hire_approval'));--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_status_check" CHECK ("automation_run"."status" in ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'skipped'));
