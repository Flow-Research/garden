-- Issue positions become fractional-indexing order keys ("a0", "a1", ...,
-- "az", "b00", ...). An integer could not hold the midpoint between two
-- neighbouring positions, so dropping a card between them was rejected.
--
-- Existing order is kept exactly: within each workspace, issues are ranked by
-- their current position (ties broken by creation time, then id), and rank n
-- becomes the n-th key of the library's own sequence, which is what
-- generateNKeysBetween(null, null, count) returns. Keys compare by code unit,
-- so the column uses COLLATE "C".
ALTER TABLE "issue" ALTER COLUMN "position" DROP DEFAULT;--> statement-breakpoint
CREATE FUNCTION pg_temp.garden_order_key(rank bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  digits constant text :=
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  n bigint := rank;
  width int := 1;
  encoded text := '';
BEGIN
  -- Width w holds 62^w keys, after all the keys of smaller widths.
  WHILE n >= power(62, width)::bigint LOOP
    n := n - power(62, width)::bigint;
    width := width + 1;
  END LOOP;
  FOR i IN 1..width LOOP
    encoded := substr(digits, (n % 62)::int + 1, 1) || encoded;
    n := n / 62;
  END LOOP;
  -- The head letter encodes the width: 'a' for one digit, 'b' for two, ...
  RETURN chr(ascii('a') + width - 1) || encoded;
END
$$;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "position_key" text COLLATE "C";--> statement-breakpoint
UPDATE "issue" AS "target"
SET "position_key" = pg_temp.garden_order_key("ranked"."rank" - 1)
FROM (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "workspace_id"
      ORDER BY "position", "created_at", "id"
    ) AS "rank"
  FROM "issue"
) AS "ranked"
WHERE "ranked"."id" = "target"."id";--> statement-breakpoint
DROP INDEX IF EXISTS "issue_workspace_position_idx";--> statement-breakpoint
ALTER TABLE "issue" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "position_key" TO "position";--> statement-breakpoint
ALTER TABLE "issue" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issue" ALTER COLUMN "position" SET DEFAULT 'a0';--> statement-breakpoint
CREATE INDEX "issue_workspace_position_idx" ON "issue" USING btree ("workspace_id","status","position");
