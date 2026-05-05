ALTER TABLE "chat_thread" ADD COLUMN "primary_issue_id" uuid;
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_primary_issue_id_issue_id_fk" FOREIGN KEY ("primary_issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "chat_thread_primary_issue_idx" ON "chat_thread" USING btree ("primary_issue_id");

ALTER TABLE "issue" ADD COLUMN "permissions_override" jsonb;
