DROP INDEX "brain_write_proposal_run_claim_idx";--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ADD COLUMN "operation_key" text;--> statement-breakpoint
UPDATE "brain_write_proposal"
SET "operation_key" = "run_id" || ':' || "claim_hash";--> statement-breakpoint
DELETE FROM "brain_write_proposal"
WHERE "id" IN (
	SELECT "id"
	FROM (
		SELECT
			"id",
			row_number() OVER (
				PARTITION BY "workspace_id", "operation_key"
				ORDER BY ("status" = 'pending') ASC, "created_at" ASC NULLS LAST, "id" ASC
			) AS "duplicate_rank"
		FROM "brain_write_proposal"
	) AS "operation_proposal"
	WHERE "duplicate_rank" > 1
);--> statement-breakpoint
DELETE FROM "brain_write_proposal"
WHERE "id" IN (
	SELECT "id"
	FROM (
		SELECT
			"id",
			row_number() OVER (
				PARTITION BY "workspace_id", "claim_hash"
				ORDER BY "created_at" ASC NULLS LAST, "id" ASC
			) AS "duplicate_rank"
		FROM "brain_write_proposal"
		WHERE "status" = 'pending'
	) AS "pending_proposal"
	WHERE "duplicate_rank" > 1
);--> statement-breakpoint
ALTER TABLE "brain_write_proposal" ALTER COLUMN "operation_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_write_proposal_operation_unique" ON "brain_write_proposal" USING btree ("workspace_id","operation_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brain_write_proposal_claim_unique" ON "brain_write_proposal" USING btree ("workspace_id","claim_hash") WHERE "brain_write_proposal"."status" = 'pending';
