ALTER TABLE "permission_request"
ADD COLUMN IF NOT EXISTS "run_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'permission_request_run_id_issue_run_id_fk'
  ) THEN
    ALTER TABLE "permission_request"
    ADD CONSTRAINT "permission_request_run_id_issue_run_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "issue_run"("id") ON DELETE SET NULL;
  END IF;
END $$;
