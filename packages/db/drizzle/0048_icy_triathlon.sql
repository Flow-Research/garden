CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_user_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_id_workspace_unique" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"agent_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_identity_check" CHECK (("team_member"."user_id" is not null) <> ("team_member"."agent_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "tool_call_audit" DROP CONSTRAINT "tool_call_audit_result_status_check";--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_workspace_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_workspace_name_unique" ON "team" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE INDEX "team_workspace_updated_idx" ON "team" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_user_unique" ON "team_member" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_team_agent_unique" ON "team_member" USING btree ("team_id","agent_id");--> statement-breakpoint
CREATE INDEX "team_member_workspace_team_idx" ON "team_member" USING btree ("workspace_id","team_id");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_team_workspace_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_workspace_team_status_idx" ON "issue" USING btree ("workspace_id","team_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "tool_call_audit" ADD CONSTRAINT "tool_call_audit_result_status_check" CHECK ("tool_call_audit"."result_status" in ('success', 'error', 'denied', 'timeout', 'approved'));