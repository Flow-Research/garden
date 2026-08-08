ALTER TABLE "document_edit" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "document_edit" CASCADE;--> statement-breakpoint
ALTER TABLE "document_version" DROP CONSTRAINT "document_version_source_check";--> statement-breakpoint
UPDATE "document_version" SET "source" = 'generated' WHERE "source" IN ('assistant_edit', 'user_accept', 'user_reject');--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_source_check" CHECK ("document_version"."source" in ('upload', 'user_upload', 'generated'));
