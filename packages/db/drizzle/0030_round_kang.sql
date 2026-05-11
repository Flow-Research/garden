DROP INDEX "automation_trigger_due_idx";--> statement-breakpoint
CREATE INDEX "automation_trigger_enabled_idx" ON "automation_trigger" USING btree ("enabled") WHERE "automation_trigger"."kind" = 'schedule' and "automation_trigger"."enabled" = true;--> statement-breakpoint
ALTER TABLE "automation_trigger" DROP COLUMN "next_run_at";--> statement-breakpoint
ALTER TABLE "automation_trigger" DROP COLUMN "last_fired_at";