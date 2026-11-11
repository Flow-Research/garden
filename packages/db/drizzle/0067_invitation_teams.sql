CREATE TABLE "invitation_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "invitation_team_invitation_team_unique" UNIQUE("invitation_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_team_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_team_workspace_fk" FOREIGN KEY ("team_id","workspace_id") REFERENCES "public"."team"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_default_team_id_team_id_fk" FOREIGN KEY ("default_team_id") REFERENCES "public"."team"("id") ON DELETE set null ON UPDATE no action;