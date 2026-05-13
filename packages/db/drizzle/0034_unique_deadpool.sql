ALTER TABLE "issue_run" DROP CONSTRAINT "issue_run_wakeup_id_issue_wakeup_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_run" DROP COLUMN "wakeup_id";--> statement-breakpoint
ALTER TABLE "issue_wakeup" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "issue_wakeup" CASCADE;
