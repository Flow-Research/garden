CREATE TABLE "team_agent_policy" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy" jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_request" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "team_agent_policy" ADD CONSTRAINT "team_agent_policy_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_agent_policy" ADD CONSTRAINT "team_agent_policy_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_agent_policy" ADD CONSTRAINT "team_agent_policy_team_workspace_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_agent_policy_workspace_idx" ON "team_agent_policy" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "permission_request" ADD CONSTRAINT "permission_request_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;