DROP INDEX "brain_write_proposal_run_claim_idx";--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ADD COLUMN "operation_key" text;--> statement-breakpoint
UPDATE "brain_write_proposal"
SET "operation_key" = "run_id" || ':' || "claim_hash";--> statement-breakpoint
DELETE FROM "brain_write_proposal" AS duplicate
USING "brain_write_proposal" AS retained
WHERE duplicate."workspace_id" = retained."workspace_id"
  AND duplicate."claim_hash" = retained."claim_hash"
  AND duplicate."id" > retained."id";--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ALTER COLUMN "operation_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_write_proposal_operation_unique" ON "brain_write_proposal" USING btree ("workspace_id","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_write_proposal_claim_unique" ON "brain_write_proposal" USING btree ("workspace_id","claim_hash");
