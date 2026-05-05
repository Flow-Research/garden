ALTER TABLE "permission_request"
ADD COLUMN "run_id" uuid REFERENCES "issue_run"("id") ON DELETE SET NULL;
