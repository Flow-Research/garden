ALTER TABLE "permission_request" ALTER COLUMN "capability_id" DROP NOT NULL;

UPDATE "permission_request"
SET "capability_id" = NULL
WHERE "kind" = 'agent_proposal';

DELETE FROM "permission_grant"
WHERE "capability_id" IN (
  SELECT "id"
  FROM "capability"
  WHERE "connector_type" IN ('garden', 'local')
);

DELETE FROM "permission_request"
WHERE "kind" = 'connector_write'
  AND "capability_id" IN (
    SELECT "id"
    FROM "capability"
    WHERE "connector_type" IN ('garden', 'local')
  );

DELETE FROM "tool_call_audit"
WHERE "capability_id" IN (
  SELECT "id"
  FROM "capability"
  WHERE "connector_type" IN ('garden', 'local')
);

DELETE FROM "invocation_log"
WHERE "capability_id" IN (
  SELECT "id"
  FROM "capability"
  WHERE "connector_type" IN ('garden', 'local')
);

DELETE FROM "capability"
WHERE "connector_type" IN ('garden', 'local');
