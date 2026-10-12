DROP INDEX "brain_write_proposal_run_claim_idx";--> statement-breakpoint
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
CREATE UNIQUE INDEX "brain_write_proposal_claim_unique" ON "brain_write_proposal" USING btree ("workspace_id","claim_hash") WHERE "brain_write_proposal"."status" = 'pending';
