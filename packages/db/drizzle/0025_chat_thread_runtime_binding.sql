ALTER TABLE "chat_thread"
ADD COLUMN "runtime_kind" text NOT NULL DEFAULT 'chat',
ADD COLUMN "runtime_key" uuid;

UPDATE "chat_thread"
SET "runtime_key" = "id"
WHERE "runtime_key" IS NULL;

UPDATE "chat_thread"
SET
  "runtime_kind" = 'issue_run',
  "runtime_key" = "primary_issue_id"
WHERE "primary_issue_id" IS NOT NULL;

ALTER TABLE "chat_thread"
ALTER COLUMN "runtime_key" SET NOT NULL;

ALTER TABLE "chat_thread"
ADD CONSTRAINT "chat_thread_runtime_kind_check"
CHECK ("runtime_kind" in ('chat', 'issue_run'));

CREATE INDEX "chat_thread_runtime_idx"
ON "chat_thread" USING btree ("runtime_kind", "runtime_key");
