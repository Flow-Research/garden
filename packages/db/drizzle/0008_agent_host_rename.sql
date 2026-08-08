-- Rename agent.do_id → agent.host_name (the AgentHost DO identifier).
ALTER TABLE "agent" RENAME COLUMN "do_id" TO "host_name";

-- Multi-agent persona columns.
ALTER TABLE "agent" ADD COLUMN "icon" text;
ALTER TABLE "agent" ADD COLUMN "capabilities" text;
ALTER TABLE "agent" ADD COLUMN "runtime_config" jsonb;
ALTER TABLE "agent" ADD COLUMN "permissions" jsonb;
ALTER TABLE "agent" ADD COLUMN "adapter_type" text NOT NULL DEFAULT 'workspace-agent';

-- Backfill agent rows for any chat_thread.agent_name without a matching
-- agent.host_name. New rows reuse the legacy host name verbatim so the
-- subsequent UPDATE finds them.
INSERT INTO "agent" (
  "id", "workspace_id", "owner_user_id", "name", "status", "host_name", "adapter_type"
)
SELECT
  gen_random_uuid(),
  ct."workspace_id",
  ct."owner_user_id",
  'Agent',
  'active',
  ct."agent_name",
  'workspace-agent'
FROM "chat_thread" ct
WHERE NOT EXISTS (
  SELECT 1
  FROM "agent" a
  WHERE a."host_name" = ct."agent_name"
    AND a."workspace_id" = ct."workspace_id"
)
GROUP BY ct."workspace_id", ct."owner_user_id", ct."agent_name";

-- chat_thread.agent_name (text) → chat_thread.agent_id (uuid FK to agent.id).
ALTER TABLE "chat_thread" ADD COLUMN "agent_id" uuid REFERENCES "agent"("id");

UPDATE "chat_thread"
SET "agent_id" = (
  SELECT a."id"
  FROM "agent" a
  WHERE a."host_name" = "chat_thread"."agent_name"
    AND a."workspace_id" = "chat_thread"."workspace_id"
  LIMIT 1
);

ALTER TABLE "chat_thread" ALTER COLUMN "agent_id" SET NOT NULL;
ALTER TABLE "chat_thread" DROP COLUMN "agent_name";

CREATE INDEX IF NOT EXISTS "chat_thread_agent_idx"
  ON "chat_thread" ("agent_id");
