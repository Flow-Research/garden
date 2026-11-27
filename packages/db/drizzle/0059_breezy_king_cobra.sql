CREATE TABLE "decide_analysis_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_runtime_name" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"workflow_instance_id" text NOT NULL,
	"question" text NOT NULL,
	"input_data" text,
	"context" text,
	"provider_session_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"progress_sequence" integer DEFAULT 0 NOT NULL,
	"progress_json" jsonb,
	"result_json" jsonb,
	"error_json" jsonb,
	"cancel_requested_at" timestamp with time zone,
	"provider_call_started_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decide_analysis_run_status_check" CHECK ("decide_analysis_run"."status" in ('queued', 'running', 'cancel_requested', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "decide_analysis_run_attempt_positive_check" CHECK ("decide_analysis_run"."attempt" > 0),
	CONSTRAINT "decide_analysis_run_progress_sequence_nonnegative_check" CHECK ("decide_analysis_run"."progress_sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "decide_analysis_run" ADD CONSTRAINT "decide_analysis_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decide_analysis_run" ADD CONSTRAINT "decide_analysis_run_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decide_analysis_run" ADD CONSTRAINT "decide_analysis_run_thread_id_chat_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decide_analysis_run" ADD CONSTRAINT "decide_analysis_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decide_analysis_run_workspace_idempotency_idx" ON "decide_analysis_run" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "decide_analysis_run_workflow_instance_idx" ON "decide_analysis_run" USING btree ("workflow_instance_id");--> statement-breakpoint
CREATE INDEX "decide_analysis_run_thread_updated_idx" ON "decide_analysis_run" USING btree ("thread_id","updated_at");--> statement-breakpoint
CREATE INDEX "decide_analysis_run_workspace_status_idx" ON "decide_analysis_run" USING btree ("workspace_id","status");