ALTER TABLE "invitation" DROP CONSTRAINT "invitation_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "member_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "agent" DROP CONSTRAINT "agent_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_thread" DROP CONSTRAINT "chat_thread_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "document" DROP CONSTRAINT "document_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "brain_folder" DROP CONSTRAINT "brain_folder_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_dismissal" DROP CONSTRAINT "inbox_dismissal_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_item" DROP CONSTRAINT "inbox_item_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue" DROP CONSTRAINT "issue_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_attachment" DROP CONSTRAINT "issue_attachment_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_run" DROP CONSTRAINT "issue_run_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_run_event" DROP CONSTRAINT "issue_run_event_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_source_binding" DROP CONSTRAINT "issue_source_binding_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_subscriber" DROP CONSTRAINT "issue_subscriber_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_work_product" DROP CONSTRAINT "issue_work_product_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "automation" DROP CONSTRAINT "automation_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_event" DROP CONSTRAINT "activity_event_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "tool_call_audit" DROP CONSTRAINT "tool_call_audit_workspace_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "chat_thread_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brain_folder" ADD CONSTRAINT "brain_folder_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_dismissal" ADD CONSTRAINT "inbox_dismissal_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_attachment" ADD CONSTRAINT "issue_attachment_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run" ADD CONSTRAINT "issue_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_run_event" ADD CONSTRAINT "issue_run_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_source_binding" ADD CONSTRAINT "issue_source_binding_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscriber" ADD CONSTRAINT "issue_subscriber_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_work_product" ADD CONSTRAINT "issue_work_product_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "activity_event_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_audit" ADD CONSTRAINT "tool_call_audit_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;