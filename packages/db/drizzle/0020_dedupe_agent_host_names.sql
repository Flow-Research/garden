-- `agent.host_name` is the Durable Object runtime address. It must resolve
-- to exactly one agent row; otherwise AgentDO can authorize a chat thread
-- against the wrong agent.

WITH ranked_agents AS (
  SELECT
    a."id",
    a."host_name",
    ROW_NUMBER() OVER (
      PARTITION BY a."host_name"
      ORDER BY
        COUNT(ct."id") DESC,
        COUNT(ir."id") DESC,
        a."created_at" ASC NULLS LAST,
        a."id" ASC
    ) AS rank
  FROM "agent" AS a
  LEFT JOIN "chat_thread" AS ct
    ON ct."agent_id" = a."id"
  LEFT JOIN "issue_run" AS ir
    ON ir."agent_id" = a."id"
  WHERE a."host_name" IS NOT NULL
    AND a."host_name" <> ''
  GROUP BY a."id", a."host_name", a."created_at"
),
duplicate_agents AS (
  SELECT "id"
  FROM ranked_agents
  WHERE rank > 1
)
UPDATE "agent" AS a
SET "host_name" = a."id"::text
FROM duplicate_agents AS d
WHERE a."id" = d."id";

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

CREATE UNIQUE INDEX IF NOT EXISTS "agent_host_name_unique_idx"
ON "agent" ("host_name")
WHERE "host_name" IS NOT NULL
  AND "host_name" <> '';
