ALTER TABLE "organization"
ADD COLUMN "issue_prefix" text NOT NULL DEFAULT 'ISS';

WITH derived AS (
  SELECT
    id,
    base,
    row_number() OVER (PARTITION BY base ORDER BY created_at NULLS LAST, id) AS suffix
  FROM (
    SELECT
      id,
      rpad(
        left(
          coalesce(nullif(regexp_replace(upper(name), '[^A-Z0-9]', '', 'g'), ''), 'ISS'),
          3
        ),
        2,
        'X'
      ) AS base,
      created_at
    FROM "organization"
  ) source
)
UPDATE "organization"
SET "issue_prefix" = left(
  CASE
    WHEN derived.suffix = 1 THEN derived.base
    ELSE derived.base || derived.suffix::text
  END,
  8
)
FROM derived
WHERE "organization".id = derived.id;

ALTER TABLE "organization"
ADD CONSTRAINT "organization_issue_prefix_format"
CHECK ("issue_prefix" ~ '^[A-Z0-9]{2,8}$');
