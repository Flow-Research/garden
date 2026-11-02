ALTER TABLE "issue_comment" DROP CONSTRAINT "issue_comment_author_type_check";--> statement-breakpoint
ALTER TABLE "issue_comment" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "external_comment_id" text;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_comment_external_comment_unique" ON "issue_comment" USING btree ("issue_id","external_comment_id") WHERE "issue_comment"."external_comment_id" is not null;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_author_id_check" CHECK (("issue_comment"."author_type" = 'connector' and "issue_comment"."author_id" is null) or ("issue_comment"."author_type" in ('user', 'agent') and "issue_comment"."author_id" is not null));--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_author_type_check" CHECK ("issue_comment"."author_type" in ('user', 'agent', 'connector'));