ALTER TABLE "issue"
  ADD CONSTRAINT "issue_priority_check"
  CHECK ("issue"."priority" in ('urgent', 'high', 'medium', 'low', 'none')) NOT VALID;
