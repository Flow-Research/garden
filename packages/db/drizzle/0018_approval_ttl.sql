ALTER TABLE "permission_request" ADD COLUMN "expires_at" timestamp DEFAULT NULL;
--> statement-breakpoint
UPDATE "permission_request"
SET "expires_at" = "requested_at" + INTERVAL '7 days'
WHERE "expires_at" IS NULL;
