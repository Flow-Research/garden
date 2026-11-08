CREATE INDEX "auth_account_user_id_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inbox_item_issue_id_idx" ON "inbox_item" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_parent_id_idx" ON "issue" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "issue_run_workspace_id_idx" ON "issue_run" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "issue_work_product_run_id_idx" ON "issue_work_product" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "automation_assignee_agent_id_idx" ON "automation" USING btree ("assignee_agent_id");--> statement-breakpoint
CREATE INDEX "automation_run_trigger_id_idx" ON "automation_run" USING btree ("trigger_id");--> statement-breakpoint
CREATE INDEX "skill_file_skill_id_idx" ON "skill_file" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skill_version_skill_id_idx" ON "skill_version" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "permission_request_run_id_idx" ON "permission_request" USING btree ("run_id");