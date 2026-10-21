-- Backfill rows written before these columns had defaults, then require them.
-- A missing updated_at falls back to the row's created_at.
UPDATE "user" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "user" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "auth_verification" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
UPDATE "auth_verification" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_verification" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_verification" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
UPDATE "auth_verification" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "auth_verification" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "invitation" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "member" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "member" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "organization" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "organization" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "agent" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "chat_thread" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chat_thread" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "chat_thread" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chat_thread" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "document" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "document" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "document_version" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "document_version" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "brain_folder" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "brain_folder" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "brain_folder" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "brain_folder" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "brain_folder_file" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "brain_folder_file" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "issue" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "issue" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "issue" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "issue" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "issue_attachment" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "issue_attachment" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "issue_comment" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "issue_comment" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "skill" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "skill" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "skill" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "skill" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "skill_assignment" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "skill_assignment" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "skill_assignment" SET "updated_at" = coalesce("created_at", now()) WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "skill_assignment" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
UPDATE "skill_version" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "skill_version" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "activity_event" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "activity_event" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
UPDATE "invocation_log" SET "created_at" = now() WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "invocation_log" ALTER COLUMN "created_at" SET NOT NULL;