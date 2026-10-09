-- Legacy hashes can collide across distinct claims or review outcomes.
-- Preserve retained rows and require an explicit resolution before migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "brain_write_proposal"
    GROUP BY "workspace_id", "claim_hash"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Brain proposal migration requires review of duplicate legacy claim hashes; no rows were deleted';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "brain_write_proposal_run_claim_idx";--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ADD COLUMN "operation_key" text;--> statement-breakpoint
UPDATE "brain_write_proposal"
SET "operation_key" = "run_id" || ':' || "claim_hash";--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ALTER COLUMN "operation_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_write_proposal_operation_unique" ON "brain_write_proposal" USING btree ("workspace_id","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_write_proposal_claim_unique" ON "brain_write_proposal" USING btree ("workspace_id","claim_hash");
