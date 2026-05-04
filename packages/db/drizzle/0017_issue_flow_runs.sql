CREATE TABLE "inbox_dismissal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_recurrence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"cron" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"next_fire_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"host_name" text NOT NULL,
	"wakeup_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"context_snapshot" jsonb,
	"result_json" jsonb,
	"usage_json" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_run_status_check" CHECK ("issue_run"."status" in ('queued', 'running', 'waiting_for_input', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "issue_run_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" text NOT NULL,
	"stream" text DEFAULT 'system' NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_run_event_stream_check" CHECK ("issue_run_event"."stream" in ('system', 'agent', 'tool', 'connector')),
	CONSTRAINT "issue_run_event_level_check" CHECK ("issue_run_event"."level" in ('info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE TABLE "issue_source_binding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"connector_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"display_ref" text,
	"title_snapshot" text,
	"metadata" jsonb,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_source_binding_connector_check" CHECK ("issue_source_binding"."connector_id" in ('github', 'slack', 'gmail', 'google_drive', 'exa_search', 'manual', 'agent')),
	CONSTRAINT "issue_source_binding_kind_check" CHECK ("issue_source_binding"."source_kind" in ('issue', 'pull_request', 'message', 'thread', 'email_thread', 'file', 'search_result'))
);
--> statement-breakpoint
CREATE TABLE "issue_wakeup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"host_name" text NOT NULL,
	"source" text NOT NULL,
	"trigger_comment_id" uuid,
	"trigger_source_id" uuid,
	"correlation_id" text,
	"idempotency_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_wakeup_source_check" CHECK ("issue_wakeup"."source" in ('assignment', 'comment', 'mention', 'manual', 'scheduled', 'connector_event', 'reconciler_retry')),
	CONSTRAINT "issue_wakeup_status_check" CHECK ("issue_wakeup"."status" in ('pending', 'claimed', 'completed', 'failed', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "issue_work_product" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"run_id" uuid,
	"agent_id" uuid,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"title" text,
	"body" text,
	"payload" jsonb,
	"applied_at" timestamp with time zone,
	"applied_external_id" text,
	"applied_external_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_work_product_type_check" CHECK ("issue_work_product"."type" in ('brief', 'plan', 'connector_reply', 'pull_request', 'report', 'checklist')),
	CONSTRAINT "issue_work_product_status_check" CHECK ("issue_work_product"."status" in ('draft', 'review', 'approved', 'applied', 'superseded')),
	CONSTRAINT "issue_work_product_review_check" CHECK ("issue_work_product"."review_state" in ('pending', 'approved', 'changes_requested'))
);
--> statement-breakpoint
ALTER TABLE "issue_source" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "issue_source" CASCADE;--> statement-breakpoint
ALTER TABLE "issue" DROP CONSTRAINT "issue_status_check";--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "run_timeout_sec" integer DEFAULT 1800 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "active_run_id" uuid;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "source_summary" text;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "mentions" jsonb;--> statement-breakpoint
CREATE INDEX "issue_comment_mentions_gin" ON "issue_comment" USING gin ("mentions");--> statement-breakpoint
ALTER TABLE "inbox_dismissal" ADD CONSTRAINT "inbox_dismissal_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_dismissal" ADD CONSTRAINT "inbox_dismissal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recurrence" ADD CONSTRAINT "issue_recurrence_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recurrence" ADD CONSTRAINT "issue_recurrence_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_recurrence" ADD CONSTRAINT "issue_recurrence_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_wakeup_id_issue_wakeup_id_fk" FOREIGN KEY ("wakeup_id") REFERENCES "public"."issue_wakeup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run_event" ADD CONSTRAINT "issue_run_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run_event" ADD CONSTRAINT "issue_run_event_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run_event" ADD CONSTRAINT "issue_run_event_run_id_issue_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."issue_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_source_binding" ADD CONSTRAINT "issue_source_binding_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_source_binding" ADD CONSTRAINT "issue_source_binding_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_wakeup" ADD CONSTRAINT "issue_wakeup_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_wakeup" ADD CONSTRAINT "issue_wakeup_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_wakeup" ADD CONSTRAINT "issue_wakeup_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_wakeup" ADD CONSTRAINT "issue_wakeup_trigger_source_id_issue_source_binding_id_fk" FOREIGN KEY ("trigger_source_id") REFERENCES "public"."issue_source_binding"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_product" ADD CONSTRAINT "issue_work_product_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_product" ADD CONSTRAINT "issue_work_product_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_product" ADD CONSTRAINT "issue_work_product_run_id_issue_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."issue_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_product" ADD CONSTRAINT "issue_work_product_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_dismissal_workspace_user_item_unique" ON "inbox_dismissal" USING btree ("workspace_id","user_id","item_key");--> statement-breakpoint
CREATE INDEX "inbox_dismissal_user_idx" ON "inbox_dismissal" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "issue_recurrence_due_idx" ON "issue_recurrence" USING btree ("enabled","next_fire_at") WHERE "issue_recurrence"."enabled" = true;--> statement-breakpoint
CREATE INDEX "issue_run_issue_idx" ON "issue_run" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_run_agent_active_idx" ON "issue_run" USING btree ("agent_id") WHERE "issue_run"."status" in ('queued', 'running', 'waiting_for_input', 'waiting_for_approval');--> statement-breakpoint
CREATE INDEX "issue_run_silent_idx" ON "issue_run" USING btree ("status","updated_at") WHERE "issue_run"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "issue_run_event_seq_unique" ON "issue_run_event" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "issue_run_event_issue_idx" ON "issue_run_event" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_source_binding_external_unique" ON "issue_source_binding" USING btree ("workspace_id","connector_id","source_kind","external_id");--> statement-breakpoint
CREATE INDEX "issue_source_binding_issue_idx" ON "issue_source_binding" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_wakeup_idempotency_active_unique" ON "issue_wakeup" USING btree ("idempotency_key") WHERE "issue_wakeup"."idempotency_key" is not null and "issue_wakeup"."status" in ('pending', 'claimed');--> statement-breakpoint
CREATE INDEX "issue_wakeup_drain_idx" ON "issue_wakeup" USING btree ("status","next_attempt_at") WHERE "issue_wakeup"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "issue_wakeup_stranded_idx" ON "issue_wakeup" USING btree ("status","claimed_at") WHERE "issue_wakeup"."status" = 'claimed';--> statement-breakpoint
CREATE UNIQUE INDEX "issue_work_product_primary_unique" ON "issue_work_product" USING btree ("issue_id","type") WHERE "issue_work_product"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "issue_work_product_issue_idx" ON "issue_work_product" USING btree ("issue_id","created_at");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_active_run_id_issue_run_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."issue_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_workspace_active_run_idx" ON "issue" USING btree ("workspace_id","active_run_id");--> statement-breakpoint
CREATE INDEX "issue_workspace_position_idx" ON "issue" USING btree ("workspace_id","status","position");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_status_check" CHECK ("issue"."status" in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'));
