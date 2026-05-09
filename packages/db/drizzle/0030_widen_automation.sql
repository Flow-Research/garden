ALTER TABLE "automation" ADD COLUMN "system_prompt" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "input_schema" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "context_sources" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "output_config" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "execution_config" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "notification_config" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "scheduling_config" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "template_source" text;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "run_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "success_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "skip_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "avg_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_next_run_idx" ON "automation" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "automation_category_idx" ON "automation" USING btree ("category");--> statement-breakpoint
CREATE INDEX "automation_tags_gin" ON "automation" USING gin ("tags");