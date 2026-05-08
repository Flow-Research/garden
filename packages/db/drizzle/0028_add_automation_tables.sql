CREATE TABLE "automation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"issue_title_template" text,
	"assignee_agent_id" uuid NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"execution_mode" text DEFAULT 'create_issue' NOT NULL,
	"concurrency_policy" text DEFAULT 'skip' NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "automation_status_check" CHECK ("automation"."status" in ('active', 'paused', 'archived')),
	CONSTRAINT "automation_priority_check" CHECK ("automation"."priority" in ('urgent', 'high', 'medium', 'low', 'none')),
	CONSTRAINT "automation_execution_mode_check" CHECK ("automation"."execution_mode" in ('create_issue', 'run_only')),
	CONSTRAINT "automation_concurrency_policy_check" CHECK ("automation"."concurrency_policy" in ('skip', 'queue', 'replace'))
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"automation_id" uuid NOT NULL,
	"trigger_id" uuid,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"issue_id" uuid,
	"issue_run_id" uuid,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_reason" text,
	"trigger_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "automation_run_source_check" CHECK ("automation_run"."source" in ('schedule', 'manual', 'webhook', 'api')),
	CONSTRAINT "automation_run_status_check" CHECK ("automation_run"."status" in ('pending', 'issue_created', 'running', 'completed', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "automation_trigger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"automation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"label" text,
	"cron_expression" text,
	"timezone" text,
	"next_run_at" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"webhook_token_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "automation_trigger_kind_check" CHECK ("automation_trigger"."kind" in ('schedule', 'webhook', 'api')),
	CONSTRAINT "automation_trigger_schedule_fields_check" CHECK (("automation_trigger"."kind" <> 'schedule') or ("automation_trigger"."cron_expression" is not null and "automation_trigger"."timezone" is not null))
);
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_assignee_agent_id_agent_id_fk" FOREIGN KEY ("assignee_agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_trigger_id_automation_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."automation_trigger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_issue_run_id_issue_run_id_fk" FOREIGN KEY ("issue_run_id") REFERENCES "public"."issue_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_trigger" ADD CONSTRAINT "automation_trigger_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_workspace_status_idx" ON "automation" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "automation_run_automation_idx" ON "automation_run" USING btree ("automation_id","triggered_at");--> statement-breakpoint
CREATE INDEX "automation_run_issue_idx" ON "automation_run" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "automation_trigger_automation_idx" ON "automation_trigger" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "automation_trigger_due_idx" ON "automation_trigger" USING btree ("enabled","next_run_at") WHERE "automation_trigger"."kind" = 'schedule' and "automation_trigger"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_trigger_webhook_token_unique" ON "automation_trigger" USING btree ("webhook_token_hash") WHERE "automation_trigger"."webhook_token_hash" is not null;