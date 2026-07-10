ALTER TABLE "issue" DROP CONSTRAINT "issue_status_check";--> statement-breakpoint
ALTER TABLE "issue" ALTER COLUMN "status" SET DEFAULT 'todo';--> statement-breakpoint
UPDATE "issue" SET "status" = 'todo', "updated_at" = now() WHERE "status" = 'backlog';--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_status_check" CHECK ("issue"."status" in ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'));