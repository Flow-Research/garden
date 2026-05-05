ALTER TABLE "chat_thread" ADD COLUMN IF NOT EXISTS "primary_issue_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_thread_primary_issue_id_issue_id_fk'
  ) THEN
    ALTER TABLE "chat_thread"
    ADD CONSTRAINT "chat_thread_primary_issue_id_issue_id_fk"
    FOREIGN KEY ("primary_issue_id") REFERENCES "public"."issue"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_thread_primary_issue_idx" ON "chat_thread" USING btree ("primary_issue_id");

ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "permissions_override" jsonb;
