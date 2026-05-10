ALTER TABLE "automation" DROP CONSTRAINT "automation_execution_mode_check";--> statement-breakpoint
ALTER TABLE "issue_run" ALTER COLUMN "issue_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_run" ALTER COLUMN "wakeup_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_run" ADD COLUMN "trigger_source" text;--> statement-breakpoint
ALTER TABLE "issue_run" ADD COLUMN "trigger_ref" jsonb;--> statement-breakpoint
ALTER TABLE "issue_run" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_run" ADD COLUMN "workflow_instance_id" text;--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_parent_run_id_issue_run_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."issue_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_run_workflow_idx" ON "issue_run" USING btree ("workflow_instance_id") WHERE "issue_run"."workflow_instance_id" is not null;--> statement-breakpoint
CREATE INDEX "issue_run_parent_idx" ON "issue_run" USING btree ("parent_run_id") WHERE "issue_run"."parent_run_id" is not null;--> statement-breakpoint
ALTER TABLE "automation" DROP COLUMN "execution_mode";--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_trigger_source_check" CHECK ("issue_run"."trigger_source" is null or "issue_run"."trigger_source" in ('schedule', 'manual', 'webhook', 'api', 'chat', 'sub_agent', 'comment', 'mention', 'assignment', 'connector_event', 'reconciler_retry', 'hire_approval', 'automation'));