-- `agent.host_name` is the runtime Durable Object name. Keep it as the
-- source of truth for runtime calls, and repair issue-run rows written with
-- agent_id in the host_name column during the AgentDO migration.

UPDATE "agent"
SET "host_name" = "id"::text
WHERE "host_name" IS NULL OR "host_name" = '';

UPDATE "issue_wakeup" AS w
SET "host_name" = a."host_name"
FROM "agent" AS a
WHERE w."agent_id" = a."id"
  AND a."host_name" IS NOT NULL
  AND w."host_name" IS DISTINCT FROM a."host_name";

UPDATE "issue_run" AS r
SET "host_name" = a."host_name"
FROM "agent" AS a
WHERE r."agent_id" = a."id"
  AND a."host_name" IS NOT NULL
  AND r."host_name" IS DISTINCT FROM a."host_name";
